-- Suwanting Coffee POS: run once in the intended Supabase project's SQL Editor.
-- Creates an isolated schema. Does not replace any existing public POS/cashflow tables.
begin;
create schema suwanting_pos;
revoke all on schema suwanting_pos from public, anon, authenticated;

create table suwanting_pos.profiles (
    id uuid primary key references auth.users(id), name varchar(100) not null, email varchar(255) not null,
    role text not null default 'cashier' check(role in ('owner','admin','cashier')), is_active boolean not null default false,
    can_manage_catalog boolean not null default false, can_discount boolean not null default false,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table suwanting_pos.categories (
    id bigint generated always as identity primary key, name varchar(80) not null, is_active boolean not null default true,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create unique index scpos_category_name on suwanting_pos.categories(lower(name)) where deleted_at is null;
create table suwanting_pos.products (
    id bigint generated always as identity primary key, category_id bigint not null references suwanting_pos.categories,
    name varchar(120) not null, sku varchar(60) not null unique, product_type text not null check(product_type in ('drink','beans','food')),
    selling_price numeric(12,2) not null check(selling_price between 0 and 999999999.99), photo_path text,
    is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table suwanting_pos.product_variants (
    id bigint generated always as identity primary key, product_id bigint not null references suwanting_pos.products,
    name varchar(80) not null, sku varchar(60) not null unique, price_adjustment numeric(12,2) not null check(price_adjustment between 0 and 999999999.99),
    is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table suwanting_pos.customers (
    id bigint generated always as identity primary key, name varchar(120) not null, phone varchar(30), email varchar(120), address varchar(255), notes varchar(1000),
    is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create index scpos_customer_phone on suwanting_pos.customers(phone);
create table suwanting_pos.inventory_units (
    id bigint generated always as identity primary key, name varchar(60) not null, symbol varchar(15) not null unique,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table suwanting_pos.ingredients (
    id bigint generated always as identity primary key, name varchar(120) not null, sku varchar(60) not null unique,
    inventory_unit_id bigint not null references suwanting_pos.inventory_units, stock_quantity numeric(15,3) not null default 0 check(stock_quantity between 0 and 999999999.999),
    minimum_stock numeric(15,3) not null default 0 check(minimum_stock between 0 and 999999999.999), is_active boolean not null default true,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create table suwanting_pos.recipes (
    id bigint generated always as identity primary key, product_id bigint not null references suwanting_pos.products,
    product_variant_id bigint references suwanting_pos.product_variants, variant_key bigint generated always as (coalesce(product_variant_id,0)) stored,
    is_active boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(product_id,variant_key)
);
create table suwanting_pos.recipe_items (
    recipe_id bigint not null references suwanting_pos.recipes, ingredient_id bigint not null references suwanting_pos.ingredients,
    quantity numeric(15,3) not null check(quantity between 0.001 and 999999.999), primary key(recipe_id,ingredient_id)
);
create table suwanting_pos.settings (id integer primary key check(id=1), data jsonb not null, updated_at timestamptz not null default now());
insert into suwanting_pos.settings values(1,'{"shop_name":"Suwanting Coffee","shop_address":"","shop_phone":"","shop_email":"","tax_enabled":false,"tax_rate":"11.00","receipt_header":"","receipt_footer":"Terima kasih sudah singgah.\nSuwanting Coffee","receipt_paper":"80","receipt_show_cashier":true,"receipt_show_customer":true,"receipt_show_sku":false,"receipt_auto_print":false,"simulate_payments":true}',now());
create table suwanting_pos.sales (
    id bigint generated always as identity primary key, invoice_number text not null unique,
    user_id uuid not null references suwanting_pos.profiles, customer_id bigint references suwanting_pos.customers, customer_name varchar(120),
    status text not null check(status in ('pending','paid')), subtotal numeric(12,2) not null, discount numeric(12,2) not null,
    tax_rate numeric(5,2) not null, tax_amount numeric(12,2) not null, total numeric(12,2) not null,
    payment_method text not null check(payment_method in ('cash','qris','transfer')), amount_received numeric(12,2) not null, change_amount numeric(12,2) not null,
    idempotency_key uuid not null unique, request_hash text not null, inventory_deducted_at timestamptz, is_demo boolean not null default false,
    notes varchar(1000), created_at timestamptz not null default now()
);
create index scpos_sales_user_date on suwanting_pos.sales(user_id,created_at desc);
create table suwanting_pos.sale_items (
    id bigint generated always as identity primary key, sale_id bigint not null references suwanting_pos.sales,
    product_id bigint not null references suwanting_pos.products, product_variant_id bigint references suwanting_pos.product_variants,
    product_name varchar(120) not null, variant_name varchar(80), sku varchar(60) not null, unit_price numeric(12,2) not null,
    quantity integer not null check(quantity between 1 and 99), subtotal numeric(12,2) not null, notes varchar(255)
);
create index scpos_sale_items_sale on suwanting_pos.sale_items(sale_id);
create table suwanting_pos.sale_item_ingredients (
    sale_item_id bigint not null references suwanting_pos.sale_items, ingredient_id bigint not null references suwanting_pos.ingredients,
    recipe_id bigint not null references suwanting_pos.recipes, ingredient_name varchar(120) not null, unit_symbol varchar(15) not null,
    quantity numeric(15,3) not null check(quantity>0), primary key(sale_item_id,ingredient_id)
);
create table suwanting_pos.stock_movements (
    id bigint generated always as identity primary key, ingredient_id bigint not null references suwanting_pos.ingredients,
    ingredient_name varchar(120) not null, unit_symbol varchar(15) not null, user_id uuid not null references suwanting_pos.profiles,
    type text not null check(type in ('receipt','adjustment','consumption')), quantity numeric(15,3) not null,
    stock_before numeric(15,3) not null, stock_after numeric(15,3) not null check(stock_after between 0 and 999999999.999),
    reference varchar(120) not null, reason varchar(500) not null, sale_id bigint references suwanting_pos.sales,
    sale_item_id bigint references suwanting_pos.sale_items, idempotency_key uuid unique, request_hash text,
    created_at timestamptz not null default now(), unique(sale_item_id,ingredient_id)
);
create index scpos_stock_history on suwanting_pos.stock_movements(ingredient_id,created_at desc);
create table suwanting_pos.audit_logs (
    id bigint generated always as identity primary key, user_id uuid not null references suwanting_pos.profiles,
    action text not null, entity text not null, entity_id text not null, before_data jsonb not null default '{}', after_data jsonb not null default '{}',
    created_at timestamptz not null default now()
);

create function suwanting_pos.actor(p_capability text default 'operate', p_lock boolean default false)
returns suwanting_pos.profiles language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles;
begin
    if p_lock then select * into actor from suwanting_pos.profiles where id=auth.uid() for update;
    else select * into actor from suwanting_pos.profiles where id=auth.uid(); end if;
    if actor.id is null or not actor.is_active then raise exception 'Akun belum aktif atau akses ditolak. Hubungi owner.' using errcode='42501'; end if;
    if p_capability='owner' and actor.role<>'owner' or
       p_capability='catalog' and not(actor.role='owner' or actor.role='admin' and actor.can_manage_catalog) or
       p_capability='customers' and actor.role not in ('owner','admin') or
       p_capability='discount' and not(actor.role='owner' or actor.role='admin' and actor.can_discount) then
        raise exception 'Akun tidak memiliki izin untuk tindakan ini.' using errcode='42501';
    end if;
    return actor;
end $$;

create function public.scpos_archive(p_entity text,p_id bigint) returns void language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles; old jsonb;
begin
    perform pg_advisory_xact_lock(741928351);
    actor:=suwanting_pos.actor(case when p_entity='customers' then 'customers' else 'catalog' end,true);
    case p_entity
    when 'customers' then
        select to_jsonb(c) into old from suwanting_pos.customers c where id=p_id and deleted_at is null;
        update suwanting_pos.customers set deleted_at=now(),is_active=false,updated_at=now() where id=p_id and deleted_at is null;
    when 'products' then
        select to_jsonb(p) into old from suwanting_pos.products p where id=p_id and deleted_at is null;
        update suwanting_pos.products set deleted_at=now(),is_active=false,updated_at=now() where id=p_id and deleted_at is null;
    when 'categories' then
        if exists(select 1 from suwanting_pos.products where category_id=p_id and deleted_at is null) then raise exception 'Kategori masih dipakai produk.' using errcode='23514'; end if;
        select to_jsonb(c) into old from suwanting_pos.categories c where id=p_id and deleted_at is null;
        update suwanting_pos.categories set deleted_at=now(),is_active=false,updated_at=now() where id=p_id and deleted_at is null;
    when 'units' then
        if exists(select 1 from suwanting_pos.ingredients where inventory_unit_id=p_id) then raise exception 'Satuan sudah dipakai bahan.' using errcode='23514'; end if;
        select to_jsonb(u) into old from suwanting_pos.inventory_units u where id=p_id and deleted_at is null;
        update suwanting_pos.inventory_units set deleted_at=now(),updated_at=now() where id=p_id and deleted_at is null;
    when 'ingredients' then
        if exists(select 1 from suwanting_pos.ingredients where id=p_id and stock_quantity<>0) or
            exists(select 1 from suwanting_pos.recipe_items i join suwanting_pos.recipes r on r.id=i.recipe_id where i.ingredient_id=p_id and r.is_active) or
            exists(select 1 from suwanting_pos.sale_item_ingredients q join suwanting_pos.sale_items i on i.id=q.sale_item_id join suwanting_pos.sales s on s.id=i.sale_id where q.ingredient_id=p_id and s.status='pending') then
            raise exception 'Bahan masih berstok, dipakai resep aktif, atau diperlukan transaksi menunggu.' using errcode='23514';
        end if;
        select to_jsonb(i) into old from suwanting_pos.ingredients i where id=p_id and deleted_at is null;
        update suwanting_pos.ingredients set deleted_at=now(),is_active=false,updated_at=now() where id=p_id and deleted_at is null;
    when 'recipes' then
        select to_jsonb(r) into old from suwanting_pos.recipes r where id=p_id;
        update suwanting_pos.recipes set is_active=false,updated_at=now() where id=p_id;
    else raise exception 'Modul tidak dapat diarsipkan.' using errcode='22023';
    end case;
    if old is null then raise exception 'Data tidak ditemukan.' using errcode='P0002'; end if;
    perform suwanting_pos.audit(actor.id,p_entity||'.archived',p_entity,p_id::text,old,jsonb_build_object('archived',true));
end $$;

create function public.scpos_customer_lookup(p_query text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
    perform suwanting_pos.actor();
    if char_length(p_query)>120 then raise exception 'Pencarian maksimal 120 karakter.' using errcode='22023'; end if;
    select coalesce(jsonb_agg(to_jsonb(c)),'[]') into result from(
        select id,name,phone from suwanting_pos.customers where is_active and deleted_at is null
        and (position(lower(coalesce(p_query,'')) in lower(name))>0 or position(coalesce(p_query,'') in coalesce(phone,''))>0) order by name,id limit 20
    ) c;
    return result;
end $$;

create function public.scpos_options() returns jsonb language plpgsql security definer set search_path='' as $$
begin
    perform suwanting_pos.actor('catalog');
    return jsonb_build_object(
        'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]') from suwanting_pos.categories c where deleted_at is null),
        'units',(select coalesce(jsonb_agg(to_jsonb(u) order by u.name),'[]') from suwanting_pos.inventory_units u where deleted_at is null),
        'ingredients',(select coalesce(jsonb_agg(to_jsonb(i) order by i.name),'[]') from (select i.*,u.symbol from suwanting_pos.ingredients i join suwanting_pos.inventory_units u on u.id=i.inventory_unit_id where i.deleted_at is null) i),
        'products',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name),'[]') from (
            select p.*,(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') from suwanting_pos.product_variants v where v.product_id=p.id) variants from suwanting_pos.products p where p.deleted_at is null
        ) p)
    );
end $$;

create function public.scpos_list(p_entity text,p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles; source text; condition text; ordering text; search text; status text; page integer; per_page integer; row_count bigint; rows jsonb;
    date_from timestamptz; date_to timestamptz; ingredient_filter bigint;
begin
    actor:=suwanting_pos.actor(case when p_entity in ('profiles','audit') then 'owner' when p_entity in ('products','categories','units','ingredients','recipes','movements','usage') then 'catalog' else 'operate' end);
    perform suwanting_pos.keys(p_filters,array['q','status','page','per_page','from','to','ingredient_id']);
    search:=coalesce(p_filters->>'q',''); status:=coalesce(p_filters->>'status','');
    page:=coalesce((p_filters->>'page')::integer,1); per_page:=coalesce((p_filters->>'per_page')::integer,20);
    if char_length(search)>120 or page not between 1 and 100000 or per_page not between 1 and 100 or status not in ('','active','inactive','low','paid','pending','receipt','adjustment','consumption') then raise exception 'Filter tidak valid.' using errcode='22023'; end if;
    date_from:=coalesce(nullif(p_filters->>'from','')::date::timestamp at time zone 'Asia/Jakarta','-infinity'::timestamptz);
    date_to:=coalesce((nullif(p_filters->>'to','')::date+1)::timestamp at time zone 'Asia/Jakarta','infinity'::timestamptz);
    if date_from>=date_to then raise exception 'Tanggal awal melewati tanggal akhir.' using errcode='22023'; end if;
    ingredient_filter:=nullif(p_filters->>'ingredient_id','')::bigint;
    condition:='($1='''' or position(lower($1) in lower(t.search_text))>0)';
    ordering:='t.name,t.id';
    case p_entity
    when 'categories' then source:='select c.*,c.name search_text from suwanting_pos.categories c where deleted_at is null';
    when 'products' then source:='select p.*,c.name category_name,p.name||'' ''||p.sku search_text,(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),''[]'') from suwanting_pos.product_variants v where v.product_id=p.id) variants from suwanting_pos.products p join suwanting_pos.categories c on c.id=p.category_id where p.deleted_at is null';
    when 'customers' then
        source:='select c.*,c.name||'' ''||coalesce(c.phone,'''') search_text from suwanting_pos.customers c where c.deleted_at is null';
        if actor.role='cashier' then source:='select id,name,phone,email,is_active,created_at,updated_at,name||'' ''||coalesce(phone,'''') search_text from suwanting_pos.customers where deleted_at is null and is_active'; end if;
    when 'units' then source:='select u.*,u.name||'' ''||u.symbol search_text from suwanting_pos.inventory_units u where deleted_at is null';
    when 'ingredients' then source:='select i.*,u.symbol,i.name||'' ''||i.sku search_text,i.stock_quantity<=i.minimum_stock low_stock from suwanting_pos.ingredients i join suwanting_pos.inventory_units u on u.id=i.inventory_unit_id where i.deleted_at is null';
    when 'recipes' then
        source:='select r.*,p.name,p.name product_name,v.name variant_name,p.name||'' ''||coalesce(v.name,'''') search_text,(select coalesce(jsonb_agg(jsonb_build_object(''ingredient_id'',i.ingredient_id,''quantity'',i.quantity,''ingredient_name'',g.name,''unit_symbol'',u.symbol) order by i.ingredient_id),''[]'') from suwanting_pos.recipe_items i join suwanting_pos.ingredients g on g.id=i.ingredient_id join suwanting_pos.inventory_units u on u.id=g.inventory_unit_id where i.recipe_id=r.id) items from suwanting_pos.recipes r join suwanting_pos.products p on p.id=r.product_id left join suwanting_pos.product_variants v on v.id=r.product_variant_id';
    when 'profiles' then source:='select p.*,p.name||'' ''||p.email search_text from suwanting_pos.profiles p';
    when 'sales' then
        source:='select s.*,p.name cashier_name,s.invoice_number||'' ''||coalesce(s.customer_name,'''') search_text from suwanting_pos.sales s join suwanting_pos.profiles p on p.id=s.user_id';
        ordering:='t.created_at desc,t.id desc'; condition:=condition||' and ($6 or t.user_id=$7)';
    when 'movements' then
        source:='select m.*,p.name user_name,m.ingredient_name||'' ''||m.reference search_text from suwanting_pos.stock_movements m join suwanting_pos.profiles p on p.id=m.user_id';
        ordering:='t.created_at desc,t.id desc'; condition:=condition||' and ($8 is null or t.ingredient_id=$8)';
    when 'usage' then
        source:='select min(m.id) id,m.ingredient_id,m.ingredient_name name,m.ingredient_name,m.unit_symbol,sum(-m.quantity) quantity_used,count(distinct m.sale_id) sale_count,max(m.created_at) created_at,m.ingredient_name search_text from suwanting_pos.stock_movements m where type=''consumption'' and m.created_at>=$4 and m.created_at<$5 group by m.ingredient_id,m.ingredient_name,m.unit_symbol';
        condition:=condition||' and ($8 is null or t.ingredient_id=$8)';
    when 'audit' then
        source:='select a.*,p.name user_name,a.action||'' ''||a.entity_id||'' ''||p.name search_text from suwanting_pos.audit_logs a join suwanting_pos.profiles p on p.id=a.user_id';
        ordering:='t.created_at desc,t.id desc';
    else raise exception 'Modul tidak valid.' using errcode='22023';
    end case;
    if p_entity in ('sales','movements','audit') then condition:=condition||' and t.created_at>=$4 and t.created_at<$5'; end if;
    if status<>'' then
        if p_entity in ('categories','products','customers','ingredients','recipes','profiles') and status in ('active','inactive') then condition:=condition||case when status='active' then ' and t.is_active' else ' and not t.is_active' end;
        elsif p_entity='ingredients' and status='low' then condition:=condition||' and t.low_stock';
        elsif p_entity='sales' and status in ('paid','pending') then condition:=condition||' and t.status='||quote_literal(status);
        elsif p_entity='movements' and status in ('receipt','adjustment','consumption') then condition:=condition||' and t.type='||quote_literal(status);
        else raise exception 'Filter status tidak cocok dengan modul.' using errcode='22023'; end if;
    end if;
    execute 'select count(*) from ('||source||') t where '||condition into row_count using search,per_page,(page-1)*per_page,date_from,date_to,actor.role<>'cashier',actor.id,ingredient_filter;
    execute 'select coalesce(jsonb_agg(to_jsonb(t)-''search_text''-''request_hash''),''[]'') from (select * from ('||source||') t where '||condition||' order by '||ordering||' limit $2 offset $3) t'
        into rows using search,per_page,(page-1)*per_page,date_from,date_to,actor.role<>'cashier',actor.id,ingredient_filter;
    return jsonb_build_object('rows',rows,'total',row_count,'page',page,'per_page',per_page);
end $$;

create function public.scpos_sale(p_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles; s suwanting_pos.sales; result jsonb;
begin
    actor:=suwanting_pos.actor();
    select * into s from suwanting_pos.sales where id=p_id;
    if not found or actor.role='cashier' and s.user_id<>actor.id then raise exception 'Transaksi tidak ditemukan.' using errcode='P0002'; end if;
    select to_jsonb(s)-'request_hash'||jsonb_build_object('cashier_name',p.name,'items',(
        select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]') from suwanting_pos.sale_items i where sale_id=p_id
    )) into result from suwanting_pos.profiles p where id=s.user_id;
    return result;
end $$;

create function public.scpos_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles; day_start timestamptz; day_end timestamptz; result jsonb;
begin
    actor:=suwanting_pos.actor();
    day_start:=(now() at time zone 'Asia/Jakarta')::date::timestamp at time zone 'Asia/Jakarta'; day_end:=day_start+interval '1 day';
    select jsonb_build_object('sales_total',coalesce(sum(total) filter(where status='paid' and created_at>=day_start and created_at<day_end),0),
        'sale_count',count(*) filter(where status='paid' and created_at>=day_start and created_at<day_end),
        'pending',count(*) filter(where status='pending')) into result from suwanting_pos.sales where actor.role<>'cashier' or user_id=actor.id;
    return result||jsonb_build_object(
        'product_count',(select count(*) from suwanting_pos.products p join suwanting_pos.categories c on c.id=p.category_id where p.is_active and c.is_active and p.deleted_at is null and c.deleted_at is null),
        'low_stock',case when actor.role='owner' or actor.role='admin' and actor.can_manage_catalog then (select count(*) from suwanting_pos.ingredients where deleted_at is null and is_active and stock_quantity<=minimum_stock) else null end,
        'weekly',(select jsonb_agg(jsonb_build_object('day',d.sale_day,'total',coalesce(s.total,0)) order by d.sale_day) from(
            select generate_series((now() at time zone 'Asia/Jakarta')::date-6,(now() at time zone 'Asia/Jakarta')::date,'1 day'::interval)::date as sale_day
        ) d left join(
            select (created_at at time zone 'Asia/Jakarta')::date as sale_day,sum(total) total from suwanting_pos.sales where status='paid' and created_at>=day_start-interval '6 days' and (actor.role<>'cashier' or user_id=actor.id) group by 1
        ) s on s.sale_day=d.sale_day),
        'methods',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from(select payment_method,sum(total) total from suwanting_pos.sales where status='paid' and created_at>=day_start and created_at<day_end and (actor.role<>'cashier' or user_id=actor.id) group by payment_method) m),
        'recent',(public.scpos_list('sales','{"per_page":8}')->'rows')
    );
end $$;

create function public.scpos_report(p_filters jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare date_from timestamptz; date_to timestamptz; result jsonb;
begin
    perform suwanting_pos.actor('owner');
    perform suwanting_pos.keys(p_filters,array['from','to']);
    date_from:=coalesce(nullif(p_filters->>'from','')::date::timestamp at time zone 'Asia/Jakarta','-infinity'::timestamptz);
    date_to:=coalesce((nullif(p_filters->>'to','')::date+1)::timestamp at time zone 'Asia/Jakarta','infinity'::timestamptz);
    if date_from>=date_to then raise exception 'Tanggal awal melewati tanggal akhir.' using errcode='22023'; end if;
    select jsonb_build_object('total',coalesce(sum(total),0),'subtotal',coalesce(sum(subtotal),0),'discount',coalesce(sum(discount),0),'tax',coalesce(sum(tax_amount),0),'count',count(*)) into result from suwanting_pos.sales where status='paid' and created_at>=date_from and created_at<date_to;
    return result||jsonb_build_object('methods',(
        select coalesce(jsonb_agg(to_jsonb(m)),'[]') from(select payment_method,sum(total) total,count(*) count from suwanting_pos.sales where status='paid' and created_at>=date_from and created_at<date_to group by payment_method order by payment_method)m
    ),'products',(
        select coalesce(jsonb_agg(to_jsonb(p)),'[]') from(select i.product_name,i.variant_name,sum(i.quantity) quantity,sum(i.subtotal) subtotal from suwanting_pos.sale_items i join suwanting_pos.sales s on s.id=i.sale_id where s.status='paid' and s.created_at>=date_from and s.created_at<date_to group by i.product_name,i.variant_name order by sum(i.quantity) desc,i.product_name limit 30)p
    ));
end $$;

create function public.scpos_bootstrap() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles;
begin
    actor:=suwanting_pos.actor();
    return jsonb_build_object('profile',to_jsonb(actor),'settings',(select data from suwanting_pos.settings where id=1),
        'categories',(select coalesce(jsonb_agg(to_jsonb(c) order by c.name),'[]') from suwanting_pos.categories c where is_active and deleted_at is null),
        'products',(select coalesce(jsonb_agg(to_jsonb(p) order by p.name),'[]') from(
            select p.*,c.name category_name,(select coalesce(jsonb_agg(to_jsonb(v) order by v.id),'[]') from suwanting_pos.product_variants v where product_id=p.id and is_active) variants
            from suwanting_pos.products p join suwanting_pos.categories c on c.id=p.category_id where p.is_active and c.is_active and p.deleted_at is null and c.deleted_at is null
        )p)
    );
end $$;

create function public.scpos_status() returns jsonb language sql security definer set search_path='' as $$
    select jsonb_build_object('version',1,'server_time',now(),'has_owner',exists(select 1 from suwanting_pos.profiles where role='owner' and is_active))
$$;

create function suwanting_pos.auth_profile() returns trigger language plpgsql security definer set search_path='' as $$
begin
    insert into suwanting_pos.profiles(id,name,email) values(new.id,left(coalesce(nullif(new.raw_user_meta_data->>'name',''),split_part(new.email,'@',1),'Pengguna'),100),coalesce(new.email,''))
        on conflict(id) do update set email=excluded.email,updated_at=now();
    return new;
end $$;
create trigger scpos_auth_profile after insert or update of email on auth.users for each row execute function suwanting_pos.auth_profile();
insert into suwanting_pos.profiles(id,name,email)
    select id,left(coalesce(nullif(raw_user_meta_data->>'name',''),split_part(email,'@',1),'Pengguna'),100),coalesce(email,'') from auth.users;

create function public.scpos_storage_access(p_write boolean default false) returns boolean language sql security definer set search_path='' as $$
    select exists(select 1 from suwanting_pos.profiles where id=auth.uid() and is_active and (not p_write or role='owner' or role='admin' and can_manage_catalog))
$$;
create function public.scpos_storage_delete(p_name text) returns boolean language sql security definer set search_path='' as $$
    select public.scpos_storage_access(true) and split_part(p_name,'/',1)=auth.uid()::text and not exists(select 1 from suwanting_pos.products where photo_path=p_name and deleted_at is null)
$$;

do $$ declare tab text; begin
    for tab in select tablename from pg_tables where schemaname='suwanting_pos' loop execute format('alter table suwanting_pos.%I enable row level security',tab); end loop;
end $$;
revoke all on all tables in schema suwanting_pos from public,anon,authenticated;
revoke all on all sequences in schema suwanting_pos from public,anon,authenticated;
revoke all on all functions in schema suwanting_pos from public,anon,authenticated;
revoke all on function public.scpos_archive(text,bigint),public.scpos_customer_lookup(text),public.scpos_options(),public.scpos_list(text,jsonb),public.scpos_sale(bigint),public.scpos_dashboard(),public.scpos_report(jsonb),public.scpos_bootstrap(),public.scpos_status(),public.scpos_storage_access(boolean),public.scpos_storage_delete(text) from public,anon,authenticated;
-- Checkout/save/stock functions are revoked/granted after their definitions below.
grant execute on function public.scpos_status() to anon,authenticated;
grant execute on function public.scpos_archive(text,bigint),public.scpos_customer_lookup(text),public.scpos_options(),public.scpos_list(text,jsonb),public.scpos_sale(bigint),public.scpos_dashboard(),public.scpos_report(jsonb),public.scpos_bootstrap(),public.scpos_storage_access(boolean),public.scpos_storage_delete(text) to authenticated;

do $$ begin
    if to_regclass('storage.buckets') is not null then
        insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('scpos-products','scpos-products',false,2097152,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
        execute 'create policy scpos_photo_read on storage.objects for select to authenticated using(bucket_id=''scpos-products'' and public.scpos_storage_access(false))';
        execute 'create policy scpos_photo_insert on storage.objects for insert to authenticated with check(bucket_id=''scpos-products'' and split_part(name,''/'',1)=auth.uid()::text and public.scpos_storage_access(true))';
        execute 'create policy scpos_photo_delete on storage.objects for delete to authenticated using(bucket_id=''scpos-products'' and public.scpos_storage_delete(name))';
    end if;
end $$;
create function suwanting_pos.keys(p jsonb, allowed text[]) returns void language plpgsql set search_path='' as $$
begin
    if jsonb_typeof(p) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p) k where not k=any(allowed)) then
        raise exception 'Field tidak diizinkan atau format data tidak valid.' using errcode='22023';
    end if;
end $$;
create function suwanting_pos.text_value(p jsonb, k text, max_length integer, required boolean default true) returns text language plpgsql set search_path='' as $$
declare v text:=btrim(coalesce(p->>k,''));
begin
    if required and v='' or char_length(v)>max_length then raise exception 'Isian % wajib diisi dengan panjang maksimal % karakter.',k,max_length using errcode='22023'; end if;
    return nullif(v,'');
end $$;
create function suwanting_pos.number_value(p jsonb, k text, decimal_places integer, maximum numeric) returns numeric language plpgsql set search_path='' as $$
declare v text:=coalesce(p->>k,'');
begin
    if v !~ ('^[0-9]{1,9}(\.[0-9]{1,'||decimal_places||'})?$') or v::numeric>maximum then raise exception 'Nominal/kuantitas % tidak valid.',k using errcode='22023'; end if;
    return v::numeric;
end $$;
create function suwanting_pos.audit(actor uuid, action text, entity text, entity_id text, before_data jsonb default '{}', after_data jsonb default '{}') returns void language sql set search_path='' as $$
    insert into suwanting_pos.audit_logs(user_id,action,entity,entity_id,before_data,after_data) values(actor,action,entity,entity_id,coalesce(before_data,'{}'),coalesce(after_data,'{}'))
$$;
create function suwanting_pos.consume(p_sale bigint,p_actor uuid) returns void language plpgsql set search_path='' as $$
declare s suwanting_pos.sales; row record; before_stock numeric; after_stock numeric;
begin
    select * into strict s from suwanting_pos.sales where id=p_sale for update;
    if s.status<>'paid' or s.inventory_deducted_at is not null then return; end if;
    perform 1 from suwanting_pos.ingredients where id in (
        select q.ingredient_id from suwanting_pos.sale_item_ingredients q join suwanting_pos.sale_items i on i.id=q.sale_item_id where i.sale_id=p_sale
    ) order by id for update;
    for row in select q.ingredient_id,sum(q.quantity) needed from suwanting_pos.sale_item_ingredients q join suwanting_pos.sale_items i on i.id=q.sale_item_id where i.sale_id=p_sale group by q.ingredient_id loop
        if not exists(select 1 from suwanting_pos.ingredients where id=row.ingredient_id and is_active and deleted_at is null and stock_quantity>=row.needed) then
            raise exception 'Stok bahan tidak cukup atau bahan nonaktif. Seluruh transaksi dibatalkan.' using errcode='23514';
        end if;
    end loop;
    for row in select q.*,i.id item_id from suwanting_pos.sale_item_ingredients q join suwanting_pos.sale_items i on i.id=q.sale_item_id where i.sale_id=p_sale order by q.ingredient_id,i.id loop
        select stock_quantity into before_stock from suwanting_pos.ingredients where id=row.ingredient_id;
        after_stock:=before_stock-row.quantity;
        update suwanting_pos.ingredients set stock_quantity=after_stock,updated_at=now() where id=row.ingredient_id;
        insert into suwanting_pos.stock_movements(ingredient_id,ingredient_name,unit_symbol,user_id,type,quantity,stock_before,stock_after,reference,reason,sale_id,sale_item_id)
            values(row.ingredient_id,row.ingredient_name,row.unit_symbol,p_actor,'consumption',-row.quantity,before_stock,after_stock,s.invoice_number,'Pemakaian resep untuk '||s.invoice_number,p_sale,row.item_id);
    end loop;
    update suwanting_pos.sales set inventory_deducted_at=now() where id=p_sale;
end $$;

create function public.scpos_checkout(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles; s suwanting_pos.sales; c suwanting_pos.customers; prod suwanting_pos.products;
    variant suwanting_pos.product_variants; cfg jsonb; line jsonb; qty integer; subtotal numeric:=0; discount numeric; tax numeric; rate numeric;
    total numeric; received numeric; method text; paid boolean; key uuid; signature text; selected_recipe bigint; item_id bigint;
begin
    perform pg_advisory_xact_lock_shared(741928351);
    actor:=suwanting_pos.actor('operate',true);
    perform suwanting_pos.keys(p_data,array['idempotency_key','customer_id','customer_name','items','discount','payment_method','amount_received','payment_confirmed','notes']);
    key:=(p_data->>'idempotency_key')::uuid;
    signature:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
    select * into s from suwanting_pos.sales where idempotency_key=key;
    if found then
        if s.user_id<>actor.id then raise exception 'Akses ditolak.' using errcode='42501'; end if;
        if s.request_hash<>signature then raise exception 'Kunci checkout sudah dipakai untuk pesanan lain.' using errcode='22023'; end if;
        return to_jsonb(s)-'request_hash';
    end if;
    if key is null or jsonb_typeof(p_data->'items') is distinct from 'array' then raise exception 'Pesanan tidak valid.' using errcode='22023'; end if;
    if jsonb_array_length(p_data->'items') not between 1 and 50 then raise exception 'Pesanan harus berisi 1–50 baris.' using errcode='22023'; end if;
    if p_data->>'customer_id' is not null then
        select * into c from suwanting_pos.customers where id=(p_data->>'customer_id')::bigint and is_active and deleted_at is null for share;
        if not found then raise exception 'Pelanggan tidak ditemukan atau nonaktif.' using errcode='22023'; end if;
    end if;
    perform suwanting_pos.text_value(p_data,'customer_name',120,false);
    perform suwanting_pos.text_value(p_data,'notes',1000,false);
    for line in select * from jsonb_array_elements(p_data->'items') loop
        perform suwanting_pos.keys(line,array['product_id','variant_id','quantity','notes']);
        if coalesce(line->>'product_id','') !~ '^[1-9][0-9]{0,14}$' or coalesce(line->>'quantity','') !~ '^[1-9][0-9]?$' then raise exception 'Produk atau kuantitas tidak valid.' using errcode='22023'; end if;
        perform suwanting_pos.text_value(line,'notes',255,false);
    end loop;
    perform 1 from suwanting_pos.products where id in(select (value->>'product_id')::bigint from jsonb_array_elements(p_data->'items')) order by id for share;
    for line in select * from jsonb_array_elements(p_data->'items') loop
        select * into prod from suwanting_pos.products where id=(line->>'product_id')::bigint and is_active and deleted_at is null;
        if not found or not exists(select 1 from suwanting_pos.categories where id=prod.category_id and is_active and deleted_at is null) then raise exception 'Produk tidak tersedia. Segarkan katalog.' using errcode='22023'; end if;
        variant:=null;
        if line->>'variant_id' is not null then
            select * into variant from suwanting_pos.product_variants where id=(line->>'variant_id')::bigint and product_id=prod.id and is_active;
            if not found then raise exception 'Varian tidak sesuai atau nonaktif.' using errcode='22023'; end if;
        end if;
        subtotal:=subtotal+(prod.selling_price+coalesce(variant.price_adjustment,0))*(line->>'quantity')::integer;
    end loop;
    if subtotal>900000000 then raise exception 'Total pesanan melewati batas transaksi.' using errcode='22023'; end if;
    discount:=suwanting_pos.number_value(jsonb_build_object('discount',coalesce(p_data->>'discount','0')),'discount',2,999999999.99);
    if discount>0 then perform suwanting_pos.actor('discount'); end if;
    if discount>subtotal then raise exception 'Diskon melebihi subtotal.' using errcode='22023'; end if;
    select data into strict cfg from suwanting_pos.settings where id=1;
    rate:=case when (cfg->>'tax_enabled')::boolean then (cfg->>'tax_rate')::numeric else 0 end;
    tax:=round((subtotal-discount)*rate/100,2); total:=subtotal-discount+tax;
    if total>999999999.99 then raise exception 'Total termasuk pajak melewati batas transaksi.' using errcode='22023'; end if;
    method:=p_data->>'payment_method';
    if method is null or method not in ('cash','qris','transfer') then raise exception 'Metode pembayaran tidak valid.' using errcode='22023'; end if;
    if method<>'cash' and not(cfg->>'simulate_payments')::boolean then raise exception 'Pembayaran simulasi nonaktif. Gunakan tunai.' using errcode='22023'; end if;
    paid:=method='cash' or coalesce((p_data->>'payment_confirmed')::boolean,false);
    if method='cash' then
        received:=suwanting_pos.number_value(p_data,'amount_received',2,999999999.99);
        if received<total then raise exception 'Uang diterima kurang dari total.' using errcode='22023'; end if;
    else received:=case when paid then total else 0 end; end if;
    insert into suwanting_pos.sales(invoice_number,user_id,customer_id,customer_name,status,subtotal,discount,tax_rate,tax_amount,total,payment_method,amount_received,change_amount,idempotency_key,request_hash,notes)
        values('SW-'||to_char(now() at time zone 'Asia/Jakarta','YYMMDD')||'-'||upper(replace(gen_random_uuid()::text,'-','')),actor.id,c.id,coalesce(c.name,nullif(btrim(p_data->>'customer_name'),'')),case when paid then 'paid' else 'pending' end,subtotal,discount,rate,tax,total,method,received,case when method='cash' then received-total else 0 end,key,signature,nullif(p_data->>'notes','')) returning * into s;
    for line in select * from jsonb_array_elements(p_data->'items') loop
        select * into prod from suwanting_pos.products where id=(line->>'product_id')::bigint;
        variant:=null;
        if line->>'variant_id' is not null then select * into variant from suwanting_pos.product_variants where id=(line->>'variant_id')::bigint; end if;
        qty:=(line->>'quantity')::integer;
        insert into suwanting_pos.sale_items(sale_id,product_id,product_variant_id,product_name,variant_name,sku,unit_price,quantity,subtotal,notes)
            values(s.id,prod.id,variant.id,prod.name,variant.name,coalesce(variant.sku,prod.sku),prod.selling_price+coalesce(variant.price_adjustment,0),qty,(prod.selling_price+coalesce(variant.price_adjustment,0))*qty,nullif(line->>'notes','')) returning id into item_id;
        selected_recipe:=null;
        select id into selected_recipe from suwanting_pos.recipes where product_id=prod.id and is_active and variant_key in(0,coalesce(variant.id,0)) order by variant_key desc limit 1;
        if selected_recipe is not null then
            if not exists(select 1 from suwanting_pos.recipe_items where recipe_id=selected_recipe) then raise exception 'Resep aktif belum memiliki bahan.' using errcode='23514'; end if;
            if exists(select 1 from suwanting_pos.recipe_items r join suwanting_pos.ingredients i on i.id=r.ingredient_id where r.recipe_id=selected_recipe and (not i.is_active or i.deleted_at is not null)) then raise exception 'Bahan resep nonaktif.' using errcode='23514'; end if;
            insert into suwanting_pos.sale_item_ingredients(sale_item_id,ingredient_id,recipe_id,ingredient_name,unit_symbol,quantity)
                select item_id,i.id,selected_recipe,i.name,u.symbol,r.quantity*qty from suwanting_pos.recipe_items r join suwanting_pos.ingredients i on i.id=r.ingredient_id join suwanting_pos.inventory_units u on u.id=i.inventory_unit_id where r.recipe_id=selected_recipe;
        end if;
    end loop;
    perform suwanting_pos.consume(s.id,actor.id);
    select * into s from suwanting_pos.sales where id=s.id;
    perform suwanting_pos.audit(actor.id,'sale.checkout','sales',s.id::text,'{}',to_jsonb(s)-'request_hash');
    return to_jsonb(s)-'request_hash';
end $$;

create function public.scpos_confirm_payment(p_id bigint) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles; s suwanting_pos.sales;
begin
    perform pg_advisory_xact_lock_shared(741928351);
    actor:=suwanting_pos.actor('operate',true);
    select * into s from suwanting_pos.sales where id=p_id for update;
    if not found or actor.role='cashier' and s.user_id<>actor.id then raise exception 'Transaksi tidak ditemukan.' using errcode='P0002'; end if;
    if s.status='paid' then return to_jsonb(s)-'request_hash'; end if;
    if not (select (data->>'simulate_payments')::boolean from suwanting_pos.settings where id=1) then raise exception 'Simulasi pembayaran nonaktif.' using errcode='42501'; end if;
    update suwanting_pos.sales set status='paid',amount_received=total where id=p_id;
    perform suwanting_pos.consume(p_id,actor.id);
    perform suwanting_pos.audit(actor.id,'payment.simulated_confirmation','sales',p_id::text,to_jsonb(s)-'request_hash',jsonb_build_object('status','paid'));
    select * into s from suwanting_pos.sales where id=p_id;
    return to_jsonb(s)-'request_hash';
end $$;

create function public.scpos_stock(p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles; ingredient suwanting_pos.ingredients; movement suwanting_pos.stock_movements; qty numeric; after_stock numeric; symbol text; signature text; key uuid; kind text; ref text; reason text;
begin
    perform pg_advisory_xact_lock_shared(741928351);
    actor:=suwanting_pos.actor('catalog',true);
    perform suwanting_pos.keys(p_data,array['ingredient_id','idempotency_key','type','direction','quantity','reference','reason']);
    key:=(p_data->>'idempotency_key')::uuid; signature:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
    if key is null then raise exception 'Kunci mutasi wajib diisi.' using errcode='22023'; end if;
    select * into movement from suwanting_pos.stock_movements where idempotency_key=key;
    if found then
        if movement.user_id<>actor.id or movement.request_hash<>signature then raise exception 'Kunci mutasi sudah dipakai data lain.' using errcode='22023'; end if;
        return to_jsonb(movement)-'request_hash';
    end if;
    select * into ingredient from suwanting_pos.ingredients where id=(p_data->>'ingredient_id')::bigint and is_active and deleted_at is null for update;
    if not found then raise exception 'Bahan tidak ditemukan atau nonaktif.' using errcode='22023'; end if;
    qty:=suwanting_pos.number_value(p_data,'quantity',3,999999999.999);
    kind:=p_data->>'type'; reason:=suwanting_pos.text_value(p_data,'reason',500);
    if qty<=0 or kind is null or kind not in ('receipt','adjustment') then raise exception 'Jenis/jumlah mutasi tidak valid.' using errcode='22023'; end if;
    if kind='adjustment' then
        if coalesce(p_data->>'direction','') not in ('add','remove') then raise exception 'Pilih arah penyesuaian.' using errcode='22023'; end if;
        if p_data->>'direction'='remove' then qty:=-qty; end if;
    end if;
    ref:=suwanting_pos.text_value(p_data,'reference',120,kind='receipt');
    ref:=coalesce(ref,'STK-'||upper(gen_random_uuid()::text));
    after_stock:=ingredient.stock_quantity+qty;
    if after_stock not between 0 and 999999999.999 then raise exception 'Mutasi menyebabkan stok negatif atau melewati kapasitas.' using errcode='23514'; end if;
    select u.symbol into symbol from suwanting_pos.inventory_units u where u.id=ingredient.inventory_unit_id;
    update suwanting_pos.ingredients set stock_quantity=after_stock,updated_at=now() where id=ingredient.id;
    insert into suwanting_pos.stock_movements(ingredient_id,ingredient_name,unit_symbol,user_id,type,quantity,stock_before,stock_after,reference,reason,idempotency_key,request_hash)
        values(ingredient.id,ingredient.name,symbol,actor.id,kind,qty,ingredient.stock_quantity,after_stock,ref,reason,key,signature) returning * into movement;
    perform suwanting_pos.audit(actor.id,'inventory.'||kind,'stock_movements',movement.id::text,jsonb_build_object('stock_quantity',ingredient.stock_quantity),to_jsonb(movement)-'request_hash');
    return to_jsonb(movement)-'request_hash';
end $$;

create function public.scpos_save(p_entity text,p_data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles; old jsonb; result jsonb; key bigint; row jsonb; variant_id bigint; kept bigint[]:='{}'; p_id bigint; v_id bigint;
    category suwanting_pos.categories; product suwanting_pos.products; customer suwanting_pos.customers; unit suwanting_pos.inventory_units;
    ingredient suwanting_pos.ingredients; recipe suwanting_pos.recipes; profile suwanting_pos.profiles; cfg jsonb; k text; amount numeric;
begin
    perform pg_advisory_xact_lock(741928351);
    actor:=suwanting_pos.actor(case when p_entity in ('settings','profiles') then 'owner' when p_entity='customers' then 'customers' else 'catalog' end,true);
    if p_entity not in ('categories','products','customers','units','ingredients','recipes','settings','profiles') then raise exception 'Modul tidak valid.' using errcode='22023'; end if;
    if p_entity not in ('settings','profiles') then key:=nullif(p_data->>'id','')::bigint; end if;
    case p_entity
    when 'categories' then
        perform suwanting_pos.keys(p_data,array['id','name','is_active']);
        if key is not null then select * into category from suwanting_pos.categories where id=key and deleted_at is null; if not found then raise no_data_found; end if; end if;
        old:=to_jsonb(category);
        if key is null then insert into suwanting_pos.categories(name,is_active) values(suwanting_pos.text_value(p_data,'name',80),coalesce((p_data->>'is_active')::boolean,true)) returning * into category;
        else update suwanting_pos.categories set name=suwanting_pos.text_value(p_data,'name',80),is_active=coalesce((p_data->>'is_active')::boolean,true),updated_at=now() where id=key returning * into category; end if;
        result:=to_jsonb(category);
    when 'customers' then
        perform suwanting_pos.keys(p_data,array['id','name','phone','email','address','notes','is_active']);
        perform suwanting_pos.text_value(p_data,'name',120); perform suwanting_pos.text_value(p_data,'phone',30,false);
        perform suwanting_pos.text_value(p_data,'email',120,false); perform suwanting_pos.text_value(p_data,'address',255,false); perform suwanting_pos.text_value(p_data,'notes',1000,false);
        if nullif(p_data->>'email','') is not null and p_data->>'email' !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Email tidak valid.' using errcode='22023'; end if;
        if key is not null then select * into customer from suwanting_pos.customers where id=key and deleted_at is null; if not found then raise no_data_found; end if; end if;
        old:=to_jsonb(customer);
        if key is null then insert into suwanting_pos.customers(name) values(btrim(p_data->>'name')) returning * into customer; key:=customer.id; end if;
        update suwanting_pos.customers set name=btrim(p_data->>'name'),phone=nullif(btrim(p_data->>'phone'),''),email=nullif(btrim(p_data->>'email'),''),address=nullif(p_data->>'address',''),notes=nullif(p_data->>'notes',''),is_active=coalesce((p_data->>'is_active')::boolean,true),updated_at=now() where id=key returning * into customer;
        result:=to_jsonb(customer);
    when 'units' then
        perform suwanting_pos.keys(p_data,array['id','name','symbol']);
        perform suwanting_pos.text_value(p_data,'name',60); perform suwanting_pos.text_value(p_data,'symbol',15);
        if key is not null then select * into unit from suwanting_pos.inventory_units where id=key and deleted_at is null; if not found then raise no_data_found; end if; end if;
        old:=to_jsonb(unit);
        if key is not null and unit.symbol<>btrim(p_data->>'symbol') and exists(select 1 from suwanting_pos.ingredients where inventory_unit_id=key) then raise exception 'Simbol satuan yang sudah digunakan tidak dapat diganti.' using errcode='22023'; end if;
        if key is null then insert into suwanting_pos.inventory_units(name,symbol) values(btrim(p_data->>'name'),btrim(p_data->>'symbol')) returning * into unit;
        else update suwanting_pos.inventory_units set name=btrim(p_data->>'name'),symbol=btrim(p_data->>'symbol'),updated_at=now() where id=key returning * into unit; end if;
        result:=to_jsonb(unit);
    when 'ingredients' then
        perform suwanting_pos.keys(p_data,array['id','name','sku','inventory_unit_id','minimum_stock','is_active']);
        perform suwanting_pos.text_value(p_data,'name',120); perform suwanting_pos.text_value(p_data,'sku',60);
        amount:=suwanting_pos.number_value(p_data,'minimum_stock',3,999999999.999);
        if not exists(select 1 from suwanting_pos.inventory_units where id=(p_data->>'inventory_unit_id')::bigint and deleted_at is null) then raise exception 'Satuan tidak tersedia.' using errcode='22023'; end if;
        if key is not null then select * into ingredient from suwanting_pos.ingredients where id=key and deleted_at is null; if not found then raise no_data_found; end if; end if;
        old:=to_jsonb(ingredient);
        if key is not null and ingredient.inventory_unit_id<>(p_data->>'inventory_unit_id')::bigint then raise exception 'Satuan bahan tidak dapat diganti.' using errcode='22023'; end if;
        if key is null then insert into suwanting_pos.ingredients(name,sku,inventory_unit_id) values(btrim(p_data->>'name'),btrim(p_data->>'sku'),(p_data->>'inventory_unit_id')::bigint) returning * into ingredient; key:=ingredient.id; end if;
        update suwanting_pos.ingredients set name=btrim(p_data->>'name'),sku=btrim(p_data->>'sku'),minimum_stock=amount,is_active=coalesce((p_data->>'is_active')::boolean,true),updated_at=now() where id=key returning * into ingredient;
        result:=to_jsonb(ingredient);
    when 'products' then
        perform suwanting_pos.keys(p_data,array['id','name','sku','category_id','selling_price','product_type','photo_path','is_active','variants']);
        perform suwanting_pos.text_value(p_data,'name',120); perform suwanting_pos.text_value(p_data,'sku',60);
        amount:=suwanting_pos.number_value(p_data,'selling_price',2,999999999.99);
        if coalesce(p_data->>'product_type','') not in ('drink','beans','food') or not exists(select 1 from suwanting_pos.categories where id=(p_data->>'category_id')::bigint and deleted_at is null) then raise exception 'Jenis produk/kategori tidak valid.' using errcode='22023'; end if;
        if nullif(p_data->>'photo_path','') is not null and p_data->>'photo_path' !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$' then raise exception 'Path foto tidak valid.' using errcode='22023'; end if;
        if key is not null then select * into product from suwanting_pos.products where id=key and deleted_at is null; if not found then raise no_data_found; end if; end if;
        old:=to_jsonb(product);
        if key is null then insert into suwanting_pos.products(name,sku,category_id,selling_price,product_type) values(btrim(p_data->>'name'),btrim(p_data->>'sku'),(p_data->>'category_id')::bigint,amount,p_data->>'product_type') returning * into product; key:=product.id; end if;
        update suwanting_pos.products set name=btrim(p_data->>'name'),sku=btrim(p_data->>'sku'),category_id=(p_data->>'category_id')::bigint,selling_price=amount,product_type=p_data->>'product_type',photo_path=nullif(p_data->>'photo_path',''),is_active=coalesce((p_data->>'is_active')::boolean,true),updated_at=now() where id=key returning * into product;
        if jsonb_typeof(p_data->'variants') is distinct from 'array' or jsonb_array_length(p_data->'variants')>8 then raise exception 'Varian harus berupa daftar maksimal 8 baris.' using errcode='22023'; end if;
        for row in select * from jsonb_array_elements(p_data->'variants') loop
            perform suwanting_pos.keys(row,array['id','name','sku','price_adjustment','is_active']);
            perform suwanting_pos.text_value(row,'name',80); perform suwanting_pos.text_value(row,'sku',60);
            amount:=suwanting_pos.number_value(row,'price_adjustment',2,999999999.99);
            variant_id:=nullif(row->>'id','')::bigint;
            if variant_id is not null and (variant_id=any(kept) or not exists(select 1 from suwanting_pos.product_variants where id=variant_id and product_id=key)) then raise exception 'Varian tidak sesuai produk atau duplikat.' using errcode='22023'; end if;
            if variant_id is null then insert into suwanting_pos.product_variants(product_id,name,sku,price_adjustment,is_active) values(key,btrim(row->>'name'),btrim(row->>'sku'),amount,coalesce((row->>'is_active')::boolean,true)) returning id into variant_id;
            else update suwanting_pos.product_variants set name=btrim(row->>'name'),sku=btrim(row->>'sku'),price_adjustment=amount,is_active=coalesce((row->>'is_active')::boolean,true),updated_at=now() where id=variant_id; end if;
            kept:=array_append(kept,variant_id);
        end loop;
        update suwanting_pos.product_variants set is_active=false,updated_at=now() where product_id=key and not id=any(kept);
        result:=to_jsonb(product);
    when 'recipes' then
        perform suwanting_pos.keys(p_data,array['id','product_id','product_variant_id','is_active','items']);
        p_id:=(p_data->>'product_id')::bigint; v_id:=nullif(p_data->>'product_variant_id','')::bigint;
        if not exists(select 1 from suwanting_pos.products where id=p_id and deleted_at is null) or v_id is not null and not exists(select 1 from suwanting_pos.product_variants where id=v_id and product_id=p_id) then raise exception 'Produk/varian resep tidak valid.' using errcode='22023'; end if;
        if jsonb_typeof(p_data->'items') is distinct from 'array' then raise exception 'Bahan resep tidak valid.' using errcode='22023'; end if;
        if jsonb_array_length(p_data->'items') not between 1 and 30 then raise exception 'Resep memerlukan 1–30 bahan.' using errcode='22023'; end if;
        if key is not null then select * into recipe from suwanting_pos.recipes where id=key; if not found then raise no_data_found; end if; end if;
        old:=to_jsonb(recipe);
        if key is null then insert into suwanting_pos.recipes(product_id,product_variant_id,is_active) values(p_id,v_id,coalesce((p_data->>'is_active')::boolean,true)) returning * into recipe; key:=recipe.id;
        else update suwanting_pos.recipes set product_id=p_id,product_variant_id=v_id,is_active=coalesce((p_data->>'is_active')::boolean,true),updated_at=now() where id=key returning * into recipe; end if;
        delete from suwanting_pos.recipe_items where recipe_id=key;
        for row in select * from jsonb_array_elements(p_data->'items') loop
            perform suwanting_pos.keys(row,array['ingredient_id','quantity']);
            amount:=suwanting_pos.number_value(row,'quantity',3,999999.999);
            if amount<=0 or not exists(select 1 from suwanting_pos.ingredients where id=(row->>'ingredient_id')::bigint and deleted_at is null and (is_active or not recipe.is_active)) then raise exception 'Bahan/takaran resep tidak valid.' using errcode='22023'; end if;
            insert into suwanting_pos.recipe_items values(key,(row->>'ingredient_id')::bigint,amount);
        end loop;
        result:=to_jsonb(recipe);
    when 'settings' then
        perform suwanting_pos.keys(p_data,array['shop_name','shop_address','shop_phone','shop_email','tax_enabled','tax_rate','receipt_header','receipt_footer','receipt_paper','receipt_show_cashier','receipt_show_customer','receipt_show_sku','receipt_auto_print','simulate_payments']);
        select data into old from suwanting_pos.settings where id=1;
        cfg:=old||p_data;
        perform suwanting_pos.text_value(cfg,'shop_name',100); perform suwanting_pos.text_value(cfg,'shop_address',255,false); perform suwanting_pos.text_value(cfg,'shop_phone',30,false); perform suwanting_pos.text_value(cfg,'shop_email',120,false);
        if nullif(cfg->>'shop_email','') is not null and cfg->>'shop_email' !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'Email toko tidak valid.' using errcode='22023'; end if;
        perform suwanting_pos.text_value(cfg,'receipt_header',500,false); perform suwanting_pos.text_value(cfg,'receipt_footer',500,false);
        amount:=suwanting_pos.number_value(cfg,'tax_rate',2,100);
        if cfg->>'receipt_paper' not in ('58','80') then raise exception 'Ukuran struk harus 58 atau 80 mm.' using errcode='22023'; end if;
        for k in select unnest(array['tax_enabled','receipt_show_cashier','receipt_show_customer','receipt_show_sku','receipt_auto_print','simulate_payments']) loop
            if jsonb_typeof(cfg->k) is distinct from 'boolean' then raise exception 'Pilihan % harus boolean.',k using errcode='22023'; end if;
        end loop;
        cfg:=jsonb_set(cfg,'{tax_rate}',to_jsonb(to_char(amount,'FM990.00')));
        update suwanting_pos.settings set data=cfg,updated_at=now() where id=1;
        result:=cfg;
    when 'profiles' then
        perform suwanting_pos.keys(p_data,array['id','name','role','is_active','can_manage_catalog','can_discount']);
        select * into profile from suwanting_pos.profiles where id=(p_data->>'id')::uuid;
        if not found then raise no_data_found; end if;
        old:=to_jsonb(profile);
        if coalesce(p_data->>'role','') not in ('owner','admin','cashier') then raise exception 'Role tidak valid.' using errcode='22023'; end if;
        if profile.id=actor.id and (p_data->>'role'<>'owner' or not coalesce((p_data->>'is_active')::boolean,false)) then raise exception 'Owner tidak dapat menonaktifkan atau menurunkan akses sendiri.' using errcode='22023'; end if;
        update suwanting_pos.profiles set name=suwanting_pos.text_value(p_data,'name',100),role=p_data->>'role',is_active=coalesce((p_data->>'is_active')::boolean,false),can_manage_catalog=coalesce((p_data->>'can_manage_catalog')::boolean,false),can_discount=coalesce((p_data->>'can_discount')::boolean,false),updated_at=now() where id=profile.id returning * into profile;
        result:=to_jsonb(profile);
    end case;
    perform suwanting_pos.audit(actor.id,p_entity||'.saved',p_entity,coalesce(result->>'id','1'),old,result);
    return result;
end $$;

create function public.scpos_seed_demo(p_confirm boolean default false) returns void language plpgsql security definer set search_path='' as $$
declare actor suwanting_pos.profiles; coffee bigint; food bigint; unit_g bigint; unit_ml bigint; ingredient_coffee bigint; ingredient_milk bigint;
    product bigint; variant bigint; row jsonb;
begin
    perform pg_advisory_xact_lock(741928351);
    actor:=suwanting_pos.actor('owner',true);
    if not p_confirm or exists(select 1 from suwanting_pos.products) or exists(select 1 from suwanting_pos.ingredients) then raise exception 'Contoh hanya dapat ditambahkan ke katalog dan inventori kosong, dengan konfirmasi.' using errcode='22023'; end if;
    coffee:=(public.scpos_save('categories','{"name":"Coffee","is_active":true}')->>'id')::bigint;
    food:=(public.scpos_save('categories','{"name":"Pastry","is_active":true}')->>'id')::bigint;
    unit_g:=(public.scpos_save('units','{"name":"Gram","symbol":"g"}')->>'id')::bigint;
    unit_ml:=(public.scpos_save('units','{"name":"Mililiter","symbol":"ml"}')->>'id')::bigint;
    ingredient_coffee:=(public.scpos_save('ingredients',jsonb_build_object('name','Biji kopi demo','sku','DEMO-BIJI','inventory_unit_id',unit_g,'minimum_stock','100','is_active',true))->>'id')::bigint;
    ingredient_milk:=(public.scpos_save('ingredients',jsonb_build_object('name','Susu demo','sku','DEMO-SUSU','inventory_unit_id',unit_ml,'minimum_stock','500','is_active',true))->>'id')::bigint;
    perform public.scpos_stock(jsonb_build_object('ingredient_id',ingredient_coffee,'idempotency_key',gen_random_uuid(),'type','receipt','quantity','2000','reference','DEMO-AWAL','reason','Saldo awal simulasi; bukan stok operasional'));
    perform public.scpos_stock(jsonb_build_object('ingredient_id',ingredient_milk,'idempotency_key',gen_random_uuid(),'type','receipt','quantity','10000','reference','DEMO-AWAL','reason','Saldo awal simulasi; bukan stok operasional'));
    for row in select * from jsonb_array_elements('[{"name":"Kopi Susu Suwanting","sku":"DEMO-KSS","price":"24000"},{"name":"Americano","sku":"DEMO-AMR","price":"20000"},{"name":"Cappuccino","sku":"DEMO-CAP","price":"26000"}]'::jsonb) loop
        product:=(public.scpos_save('products',jsonb_build_object('name',row->>'name','sku',row->>'sku','category_id',coffee,'selling_price',row->>'price','product_type','drink','is_active',true,'variants',jsonb_build_array(jsonb_build_object('name','Iced','sku',(row->>'sku')||'-ICED','price_adjustment','2000','is_active',true))))->>'id')::bigint;
        perform public.scpos_save('recipes',jsonb_build_object('product_id',product,'is_active',true,'items',case when row->>'sku'='DEMO-AMR' then jsonb_build_array(jsonb_build_object('ingredient_id',ingredient_coffee,'quantity','18')) else jsonb_build_array(jsonb_build_object('ingredient_id',ingredient_coffee,'quantity','18'),jsonb_build_object('ingredient_id',ingredient_milk,'quantity','120')) end));
    end loop;
    perform public.scpos_save('products',jsonb_build_object('name','Butter Croissant','sku','DEMO-CRO','category_id',food,'selling_price','22000','product_type','food','is_active',true,'variants','[]'::jsonb));
    perform public.scpos_save('customers','{"name":"Pelanggan Contoh","phone":"081200000000","is_active":true}');
    perform suwanting_pos.audit(actor.id,'demo.seeded','catalog','demo','{}',jsonb_build_object('simulated',true));
end $$;

revoke all on all functions in schema suwanting_pos from public,anon,authenticated;
revoke all on function public.scpos_checkout(jsonb),public.scpos_confirm_payment(bigint),public.scpos_stock(jsonb),public.scpos_save(text,jsonb),public.scpos_seed_demo(boolean) from public,anon,authenticated;
grant execute on function public.scpos_checkout(jsonb),public.scpos_confirm_payment(bigint),public.scpos_stock(jsonb),public.scpos_save(text,jsonb),public.scpos_seed_demo(boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
