-- Additive upgrade: preserves existing products, sales, stock and private schemas.
begin;

create table suwanting_pos.product_types (
    code varchar(30) primary key, name varchar(80) not null, is_active boolean not null default true,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
insert into suwanting_pos.product_types(code,name) values ('drink','Minuman'),('beans','Kopi kemasan'),('food','Makanan');
create unique index scpos_product_type_name on suwanting_pos.product_types(lower(name)) where deleted_at is null;
alter table suwanting_pos.product_types enable row level security;
revoke all on suwanting_pos.product_types from public,anon,authenticated;
alter table suwanting_pos.products drop constraint products_product_type_check;
alter table suwanting_pos.products add constraint scpos_product_type_fk foreign key(product_type) references suwanting_pos.product_types(code) on update cascade;
alter table suwanting_pos.profiles add column phone varchar(30), add column avatar_path text;
update suwanting_pos.settings set data=data||'{"logo_path":null}'::jsonb where id=1;

-- Image keys contain the uploading user's ID; callers cannot select another account's photo.
create function public.scpos_asset_access(p_bucket text,p_name text,p_write boolean default false) returns boolean
language sql security definer set search_path='' as $$
    select exists(select 1 from suwanting_pos.profiles p where p.id=auth.uid() and p.is_active and (
        p_bucket='scpos-avatars' and split_part(p_name,'/',1)=p.id::text or
        p_bucket='scpos-branding' and (not p_write or p.role='owner' and split_part(p_name,'/',1)=p.id::text)
    ))
$$;
create function public.scpos_asset_delete(p_bucket text,p_name text) returns boolean
language sql security definer set search_path='' as $$
    select public.scpos_asset_access(p_bucket,p_name,true)
        and split_part(p_name,'/',1)=auth.uid()::text
        and not exists(select 1 from suwanting_pos.profiles where avatar_path=p_name and p_bucket='scpos-avatars')
        and not exists(select 1 from suwanting_pos.settings where data->>'logo_path'=p_name and p_bucket='scpos-branding')
$$;
do $$ begin
    if to_regclass('storage.buckets') is not null then
        insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
            ('scpos-avatars','scpos-avatars',false,2097152,array['image/jpeg','image/png','image/webp']),
            ('scpos-branding','scpos-branding',true,2097152,array['image/jpeg','image/png','image/webp']);
        execute 'create policy scpos_account_image_read on storage.objects for select to authenticated using(public.scpos_asset_access(bucket_id,name,false))';
        execute 'create policy scpos_account_image_insert on storage.objects for insert to authenticated with check(name ~ ''^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'' and public.scpos_asset_access(bucket_id,name,true))';
        execute 'create policy scpos_account_image_delete on storage.objects for delete to authenticated using(public.scpos_asset_delete(bucket_id,name))';
    end if;
end $$;
create function suwanting_pos.validate_asset(p_bucket text,p_path text,p_current text) returns void language plpgsql set search_path='' as $$
begin
    if p_path is null then return; end if;
    if p_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' then raise exception 'Path gambar tidak valid.' using errcode='22023'; end if;
    if p_path is distinct from p_current and split_part(p_path,'/',1)<>auth.uid()::text then raise exception 'Gambar harus diunggah melalui akun sendiri.' using errcode='42501'; end if;
    if not exists(select 1 from storage.objects where bucket_id=p_bucket and name=p_path
        and metadata->>'mimetype' in ('image/jpeg','image/png','image/webp') and (metadata->>'size')::bigint between 1 and 2097152) then
        raise exception 'Gambar belum terunggah atau format/ukurannya tidak valid.' using errcode='22023';
    end if;
end $$;

create function public.scpos_account(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor suwanting_pos.profiles; v_old jsonb; v_name text; v_phone text; v_avatar text;
begin
    v_actor:=suwanting_pos.actor('operate',true);
    perform suwanting_pos.keys(p_data,array['name','phone','avatar_path']);
    v_name:=suwanting_pos.text_value(p_data,'name',100); v_phone:=suwanting_pos.text_value(p_data,'phone',30,false);
    v_avatar:=nullif(btrim(p_data->>'avatar_path'),'');
    perform suwanting_pos.validate_asset('scpos-avatars',v_avatar,v_actor.avatar_path);
    v_old:=to_jsonb(v_actor);
    update suwanting_pos.profiles set name=v_name,phone=v_phone,avatar_path=v_avatar,updated_at=now() where id=v_actor.id returning * into v_actor;
    perform suwanting_pos.audit(v_actor.id,'account.saved','profiles',v_actor.id::text,v_old,to_jsonb(v_actor));
    return to_jsonb(v_actor);
end $$;
create function public.scpos_branding(p_logo_path text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor suwanting_pos.profiles; v_old jsonb; v_cfg jsonb;
begin
    perform pg_advisory_xact_lock(741928351);
    v_actor:=suwanting_pos.actor('owner',true);
    select data into v_old from suwanting_pos.settings where id=1 for update;
    p_logo_path:=nullif(btrim(p_logo_path),''); perform suwanting_pos.validate_asset('scpos-branding',p_logo_path,v_old->>'logo_path');
    v_cfg:=jsonb_set(v_old,'{logo_path}',coalesce(to_jsonb(p_logo_path),'null'::jsonb));
    update suwanting_pos.settings set data=v_cfg,updated_at=now() where id=1;
    perform suwanting_pos.audit(v_actor.id,'settings.logo_saved','settings','1',v_old,v_cfg);
    return v_cfg;
end $$;

create function public.scpos_product_type_list(p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare v_search text; v_status text; v_page integer; v_per_page integer; v_total bigint; v_rows jsonb;
begin
    perform suwanting_pos.actor('catalog');
    perform suwanting_pos.keys(p_filters,array['q','status','page','per_page']);
    v_search:=coalesce(p_filters->>'q',''); v_status:=coalesce(p_filters->>'status','');
    v_page:=coalesce((p_filters->>'page')::integer,1); v_per_page:=coalesce((p_filters->>'per_page')::integer,20);
    if char_length(v_search)>120 or v_page not between 1 and 100000 or v_per_page not between 1 and 100 or v_status not in ('','active','inactive') then raise exception 'Filter jenis produk tidak valid.' using errcode='22023'; end if;
    select count(*) into v_total from suwanting_pos.product_types t where t.deleted_at is null
        and position(lower(v_search) in lower(t.code||' '||t.name))>0
        and (v_status='' or v_status='active' and t.is_active or v_status='inactive' and not t.is_active);
    select coalesce(jsonb_agg(to_jsonb(t) order by t.name,t.code),'[]') into v_rows from (
        select code id,code,name,is_active,created_at,updated_at from suwanting_pos.product_types t where t.deleted_at is null
            and position(lower(v_search) in lower(t.code||' '||t.name))>0
            and (v_status='' or v_status='active' and t.is_active or v_status='inactive' and not t.is_active)
            order by t.name,t.code limit v_per_page offset (v_page-1)*v_per_page
    ) t;
    return jsonb_build_object('rows',v_rows,'total',v_total,'page',v_page,'per_page',v_per_page);
end $$;
create function public.scpos_product_type_save(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor suwanting_pos.profiles; v_old jsonb; v_row suwanting_pos.product_types; v_id text; v_code text; v_name text; v_active boolean;
begin
    perform pg_advisory_xact_lock(741928351); v_actor:=suwanting_pos.actor('catalog',true);
    perform suwanting_pos.keys(p_data,array['id','code','name','is_active']);
    v_id:=nullif(btrim(p_data->>'id'),''); v_code:=lower(btrim(coalesce(p_data->>'code',''))); v_name:=suwanting_pos.text_value(p_data,'name',80);
    v_active:=coalesce((p_data->>'is_active')::boolean,true);
    if v_code !~ '^[a-z][a-z0-9_-]{1,29}$' then raise exception 'Kode jenis produk harus 2–30 karakter: huruf kecil, angka, - atau _.' using errcode='22023'; end if;
    if v_id is not null then
        select * into v_row from suwanting_pos.product_types where code=v_id and deleted_at is null;
        if not found then raise no_data_found; end if;
        if not v_active and exists(select 1 from suwanting_pos.products where product_type=v_id and is_active and deleted_at is null) then raise exception 'Nonaktifkan atau pindahkan produk aktif sebelum menonaktifkan jenis ini.' using errcode='23514'; end if;
    end if;
    v_old:=to_jsonb(v_row);
    if v_id is null then insert into suwanting_pos.product_types(code,name,is_active) values(v_code,v_name,v_active) returning * into v_row;
    else update suwanting_pos.product_types set code=v_code,name=v_name,is_active=v_active,updated_at=now() where code=v_id returning * into v_row; end if;
    perform suwanting_pos.audit(v_actor.id,'product_types.saved','product_types',v_row.code,v_old,to_jsonb(v_row));
    return jsonb_build_object('id',v_row.code)||to_jsonb(v_row);
end $$;
create function public.scpos_product_type_archive(p_code text) returns void language plpgsql security definer set search_path='' as $$
declare v_actor suwanting_pos.profiles; v_old jsonb;
begin
    perform pg_advisory_xact_lock(741928351); v_actor:=suwanting_pos.actor('catalog',true);
    if exists(select 1 from suwanting_pos.products where product_type=p_code and deleted_at is null) then raise exception 'Jenis produk masih dipakai produk.' using errcode='23514'; end if;
    select to_jsonb(t) into v_old from suwanting_pos.product_types t where code=p_code and deleted_at is null;
    if v_old is null then raise no_data_found; end if;
    update suwanting_pos.product_types set deleted_at=now(),is_active=false,updated_at=now() where code=p_code;
    perform suwanting_pos.audit(v_actor.id,'product_types.archived','product_types',p_code,v_old,'{"archived":true}');
end $$;

-- SKU suggestions are provisional. Save generates again inside the catalog lock.
create function suwanting_pos.sku_used(p_sku text,p_entity text,p_id bigint default null,p_variant bigint default null) returns boolean language sql set search_path='' as $$
    select case when p_entity='ingredients' then exists(select 1 from suwanting_pos.ingredients where lower(sku)=lower(p_sku) and id is distinct from p_id)
    else exists(select 1 from suwanting_pos.products where lower(sku)=lower(p_sku) and id is distinct from p_id)
        or exists(select 1 from suwanting_pos.product_variants where lower(sku)=lower(p_sku) and id is distinct from p_variant) end
$$;
create function suwanting_pos.next_sku(p_name text,p_entity text,p_reserved text[] default '{}') returns text language plpgsql set search_path='' as $$
declare v_prefix text; v_candidate text; v_number integer:=1;
begin
    v_prefix:=left(regexp_replace(upper(p_name),'[^A-Z0-9]','','g'),3);
    if v_prefix='' then v_prefix:=case when p_entity='ingredients' then 'BHN' else 'PRD' end; end if;
    v_prefix:=rpad(v_prefix,3,'X');
    loop
        v_candidate:=v_prefix||'-'||case when v_number<1000 then lpad(v_number::text,3,'0') else v_number::text end;
        if not suwanting_pos.sku_used(v_candidate,p_entity) and not exists(select 1 from unnest(p_reserved) s where lower(s)=lower(v_candidate)) then return v_candidate; end if;
        v_number:=v_number+1;
    end loop;
end $$;
create function public.scpos_suggest_sku(p_name text,p_entity text default 'products',p_reserved jsonb default '[]') returns text language plpgsql security definer set search_path='' as $$
begin
    perform suwanting_pos.actor('catalog');
    if p_entity not in ('products','ingredients') or p_name is null or char_length(p_name)>201 or jsonb_typeof(p_reserved) is distinct from 'array' then raise exception 'Permintaan SKU tidak valid.' using errcode='22023'; end if;
    if jsonb_array_length(p_reserved)>9 or exists(select 1 from jsonb_array_elements(p_reserved) r where jsonb_typeof(r)<>'string' or char_length(r#>>'{}')>60) then raise exception 'Daftar SKU tidak valid.' using errcode='22023'; end if;
    return suwanting_pos.next_sku(p_name,p_entity,array(select jsonb_array_elements_text(p_reserved)));
end $$;

create or replace function public.scpos_save(p_entity text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor suwanting_pos.profiles; v_old jsonb; v_product suwanting_pos.products; v_result jsonb; v_key bigint;
    v_row jsonb; v_variant bigint; v_kept bigint[]:='{}'; v_price numeric; v_cost numeric; v_name text; v_sku text; v_active boolean; v_description text;
begin
    if p_entity not in ('products','ingredients','settings') then return suwanting_pos.scpos_save(p_entity,p_data); end if;
    perform pg_advisory_xact_lock(741928351);
    v_actor:=suwanting_pos.actor(case when p_entity='settings' then 'owner' else 'catalog' end,true);
    if p_entity='settings' then
        -- Logo is saved through scpos_branding, never accepted as an arbitrary URL.
        if p_data?'logo_path' and p_data->>'logo_path' is distinct from (select data->>'logo_path' from suwanting_pos.settings where id=1) then raise exception 'Simpan logo melalui unggah logo.' using errcode='22023'; end if;
        return suwanting_pos.scpos_save(p_entity,p_data-'logo_path');
    end if;
    v_key:=nullif(p_data->>'id','')::bigint; v_name:=suwanting_pos.text_value(p_data,'name',120);
    if p_data?'sku_auto' and jsonb_typeof(p_data->'sku_auto') is distinct from 'boolean' then raise exception 'Pilihan SKU otomatis tidak valid.' using errcode='22023'; end if;
    if coalesce((p_data->>'sku_auto')::boolean,false) or nullif(btrim(p_data->>'sku'),'') is null then v_sku:=suwanting_pos.next_sku(v_name,p_entity);
    else v_sku:=upper(suwanting_pos.text_value(p_data,'sku',60)); end if;
    if suwanting_pos.sku_used(v_sku,p_entity,v_key) then raise exception 'SKU % sudah dipakai. Pilih SKU lain atau gunakan otomatis.',v_sku using errcode='23505'; end if;
    if p_entity='ingredients' then return suwanting_pos.scpos_save(p_entity,(p_data-'sku_auto')||jsonb_build_object('sku',v_sku)); end if;
    perform suwanting_pos.keys(p_data,array['id','name','sku','sku_auto','category_id','selling_price','cost_price','description','product_type','photo_path','is_active','variants']);
    v_price:=suwanting_pos.number_value(p_data,'selling_price',2,999999999.99);
    if p_data?'cost_price' then v_cost:=suwanting_pos.number_value(p_data,'cost_price',2,999999999.99); end if;
    if p_data?'description' then v_description:=suwanting_pos.text_value(p_data,'description',1000,false); end if;
    v_active:=coalesce((p_data->>'is_active')::boolean,true);
    if not exists(select 1 from suwanting_pos.product_types where code=p_data->>'product_type' and deleted_at is null and (is_active or not v_active))
        or not exists(select 1 from suwanting_pos.categories where id=(p_data->>'category_id')::bigint and deleted_at is null) then raise exception 'Jenis produk/kategori tidak valid atau nonaktif.' using errcode='22023'; end if;
    if nullif(p_data->>'photo_path','') is not null and p_data->>'photo_path' !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' then raise exception 'Path foto tidak valid.' using errcode='22023'; end if;
    if v_key is not null then select * into v_product from suwanting_pos.products where id=v_key and deleted_at is null; if not found then raise no_data_found; end if; end if;
    v_old:=to_jsonb(v_product);
    if v_key is null then insert into suwanting_pos.products(name,sku,category_id,selling_price,product_type) values(v_name,v_sku,(p_data->>'category_id')::bigint,v_price,p_data->>'product_type') returning * into v_product; v_key:=v_product.id; end if;
    update suwanting_pos.products set name=v_name,sku=v_sku,category_id=(p_data->>'category_id')::bigint,selling_price=v_price,product_type=p_data->>'product_type',
        cost_price=coalesce(v_cost,cost_price),description=case when p_data?'description' then v_description else description end,
        photo_path=nullif(p_data->>'photo_path',''),is_active=v_active,updated_at=now() where id=v_key returning * into v_product;
    if jsonb_typeof(p_data->'variants') is distinct from 'array' then raise exception 'Varian harus berupa daftar.' using errcode='22023'; end if;
    if jsonb_array_length(p_data->'variants')>8 then raise exception 'Maksimal 8 varian.' using errcode='22023'; end if;
    for v_row in select * from jsonb_array_elements(p_data->'variants') loop
        perform suwanting_pos.keys(v_row,array['id','name','sku','sku_auto','price_adjustment','is_active']);
        perform suwanting_pos.text_value(v_row,'name',80); v_price:=suwanting_pos.number_value(v_row,'price_adjustment',2,999999999.99);
        v_variant:=nullif(v_row->>'id','')::bigint;
        if v_variant is not null and (v_variant=any(v_kept) or not exists(select 1 from suwanting_pos.product_variants where id=v_variant and product_id=v_key)) then raise exception 'Varian tidak sesuai produk atau duplikat.' using errcode='22023'; end if;
        if v_row?'sku_auto' and jsonb_typeof(v_row->'sku_auto') is distinct from 'boolean' then raise exception 'Pilihan SKU otomatis tidak valid.' using errcode='22023'; end if;
        if coalesce((v_row->>'sku_auto')::boolean,false) or nullif(btrim(v_row->>'sku'),'') is null then v_sku:=suwanting_pos.next_sku(v_name||' '||(v_row->>'name'),'products');
        else v_sku:=upper(suwanting_pos.text_value(v_row,'sku',60)); end if;
        if suwanting_pos.sku_used(v_sku,'products',null,v_variant) then raise exception 'SKU varian % sudah dipakai.',v_sku using errcode='23505'; end if;
        if v_variant is null then insert into suwanting_pos.product_variants(product_id,name,sku,price_adjustment,is_active) values(v_key,btrim(v_row->>'name'),v_sku,v_price,coalesce((v_row->>'is_active')::boolean,true)) returning id into v_variant;
        else update suwanting_pos.product_variants set name=btrim(v_row->>'name'),sku=v_sku,price_adjustment=v_price,is_active=coalesce((v_row->>'is_active')::boolean,true),updated_at=now() where id=v_variant; end if;
        v_kept:=array_append(v_kept,v_variant);
    end loop;
    update suwanting_pos.product_variants set is_active=false,updated_at=now() where product_id=v_key and not id=any(v_kept);
    v_result:=to_jsonb(v_product);
    perform suwanting_pos.audit(v_actor.id,'products.saved','products',v_key::text,v_old,v_result);
    return v_result;
end $$;

create or replace function public.scpos_options() returns jsonb language plpgsql security definer set search_path='' as $$
begin
    perform suwanting_pos.actor('catalog');
    return jsonb_build_object(
        'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]') from suwanting_pos.categories c where deleted_at is null),
        'units',(select coalesce(jsonb_agg(to_jsonb(u) order by u.name),'[]') from suwanting_pos.inventory_units u where deleted_at is null),
        'ingredients',(select coalesce(jsonb_agg(to_jsonb(i) order by i.name),'[]') from (select i.*,u.symbol from suwanting_pos.ingredients i join suwanting_pos.inventory_units u on u.id=i.inventory_unit_id where i.deleted_at is null) i),
        'products',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name),'[]') from (
            select p.*,(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') from suwanting_pos.product_variants v where v.product_id=p.id) variants from suwanting_pos.products p where p.deleted_at is null
        ) p),
        'product_types',(select coalesce(jsonb_agg(jsonb_build_object('id',code,'name',name,'is_active',is_active) order by name),'[]') from suwanting_pos.product_types where deleted_at is null)
    );
end $$;

-- Hard-delete only unused master data. Historical references require archive instead.
create function public.scpos_delete(p_entity text,p_id text) returns void language plpgsql security definer set search_path='' as $$
declare v_actor suwanting_pos.profiles; v_old jsonb; v_id bigint;
begin
    perform pg_advisory_xact_lock(741928351); v_actor:=suwanting_pos.actor(case when p_entity='customers' then 'customers' else 'catalog' end,true);
    if p_entity<>'product_types' then v_id:=p_id::bigint; end if;
    case p_entity
    when 'categories' then
        if exists(select 1 from suwanting_pos.products where category_id=v_id) then raise exception 'Kategori masih terhubung produk. Pindahkan produk atau gunakan Arsipkan.' using errcode='23514'; end if;
        select to_jsonb(c) into v_old from suwanting_pos.categories c where id=v_id and deleted_at is null;
        delete from suwanting_pos.categories where id=v_id and deleted_at is null;
    when 'product_types' then
        if exists(select 1 from suwanting_pos.products where product_type=p_id) then raise exception 'Jenis produk masih terhubung produk. Pindahkan produk atau gunakan Arsipkan.' using errcode='23514'; end if;
        select to_jsonb(t) into v_old from suwanting_pos.product_types t where code=p_id and deleted_at is null;
        delete from suwanting_pos.product_types where code=p_id and deleted_at is null;
    when 'products' then
        if exists(select 1 from suwanting_pos.sale_items where product_id=v_id) or exists(select 1 from suwanting_pos.recipes where product_id=v_id) then raise exception 'Produk mempunyai resep atau riwayat transaksi. Gunakan Arsipkan.' using errcode='23514'; end if;
        select to_jsonb(p) into v_old from suwanting_pos.products p where id=v_id and deleted_at is null;
        delete from suwanting_pos.product_variants where product_id=v_id;
        delete from suwanting_pos.products where id=v_id and deleted_at is null;
    when 'customers' then
        if exists(select 1 from suwanting_pos.sales where customer_id=v_id) then raise exception 'Pelanggan mempunyai riwayat transaksi. Gunakan Arsipkan.' using errcode='23514'; end if;
        select to_jsonb(c) into v_old from suwanting_pos.customers c where id=v_id and deleted_at is null;
        delete from suwanting_pos.customers where id=v_id and deleted_at is null;
    when 'units' then
        if exists(select 1 from suwanting_pos.ingredients where inventory_unit_id=v_id) then raise exception 'Satuan sudah dipakai bahan. Gunakan Arsipkan.' using errcode='23514'; end if;
        select to_jsonb(u) into v_old from suwanting_pos.inventory_units u where id=v_id and deleted_at is null;
        delete from suwanting_pos.inventory_units where id=v_id and deleted_at is null;
    when 'ingredients' then
        if exists(select 1 from suwanting_pos.recipe_items where ingredient_id=v_id) or exists(select 1 from suwanting_pos.stock_movements where ingredient_id=v_id)
            or exists(select 1 from suwanting_pos.sale_item_ingredients where ingredient_id=v_id) or exists(select 1 from suwanting_pos.ingredients where id=v_id and stock_quantity<>0) then raise exception 'Bahan mempunyai stok, resep atau riwayat mutasi. Gunakan Arsipkan.' using errcode='23514'; end if;
        select to_jsonb(i) into v_old from suwanting_pos.ingredients i where id=v_id and deleted_at is null;
        delete from suwanting_pos.ingredients where id=v_id and deleted_at is null;
    when 'recipes' then
        if exists(select 1 from suwanting_pos.sale_item_ingredients where recipe_id=v_id) then raise exception 'Resep mempunyai riwayat pemakaian. Gunakan Arsipkan.' using errcode='23514'; end if;
        select to_jsonb(r) into v_old from suwanting_pos.recipes r where id=v_id;
        delete from suwanting_pos.recipe_items where recipe_id=v_id;
        delete from suwanting_pos.recipes where id=v_id;
    else raise exception 'Modul tidak mendukung penghapusan.' using errcode='22023';
    end case;
    if v_old is null then raise no_data_found; end if;
    perform suwanting_pos.audit(v_actor.id,p_entity||'.deleted',p_entity,p_id,v_old,'{}');
end $$;

create or replace function public.scpos_status() returns jsonb language sql security definer set search_path='' as $$
    select jsonb_build_object('version',3,'server_time',now(),'has_owner',exists(select 1 from suwanting_pos.profiles where role='owner' and is_active),
        'branding',(select jsonb_build_object('shop_name',data->>'shop_name','logo_path',data->>'logo_path') from suwanting_pos.settings where id=1))
$$;
revoke all on all functions in schema suwanting_pos from public,anon,authenticated;
revoke all on function public.scpos_account(jsonb),public.scpos_branding(text),public.scpos_asset_access(text,text,boolean),public.scpos_asset_delete(text,text),public.scpos_product_type_list(jsonb),public.scpos_product_type_save(jsonb),public.scpos_product_type_archive(text),public.scpos_suggest_sku(text,text,jsonb),public.scpos_delete(text,text) from public,anon,authenticated;
grant execute on function public.scpos_account(jsonb),public.scpos_branding(text),public.scpos_asset_access(text,text,boolean),public.scpos_asset_delete(text,text),public.scpos_product_type_list(jsonb),public.scpos_product_type_save(jsonb),public.scpos_product_type_archive(text),public.scpos_suggest_sku(text,text,jsonb),public.scpos_delete(text,text) to authenticated;
notify pgrst,'reload schema';
commit;
