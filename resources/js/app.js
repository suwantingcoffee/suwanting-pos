import Alpine from 'alpinejs';
import { createIcons, Coffee, LayoutDashboard, ShoppingBag, ReceiptText, Package, Tags, ChartNoAxesCombined, Users, History, Settings, LogOut, Menu, SunMoon, FlaskConical, Plus, ArrowRight, ArrowLeft, Wallet, Clock, Search, Croissant, ShoppingBasket, Pencil, Archive, Save, Trash2, Printer, UserPlus, Warehouse } from 'lucide';
const iconSet={Coffee,LayoutDashboard,ShoppingBag,ReceiptText,Package,Tags,ChartNoAxesCombined,Users,History,Settings,LogOut,Menu,SunMoon,FlaskConical,Plus,ArrowRight,ArrowLeft,Wallet,Clock,Search,Croissant,ShoppingBasket,Pencil,Archive,Save,Trash2,Printer,UserPlus,Warehouse};
const refreshIcons=()=>createIcons({icons:iconSet});
const money=(cents)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',minimumFractionDigits:0,maximumFractionDigits:2}).format(cents/100);
const cents=(amount)=>Math.round((Number(amount)||0)*100);
window.Alpine=Alpine;

Alpine.data('recipeEditor',()=>{
    const data=JSON.parse(document.getElementById('recipe-editor-data')?.textContent||'{}');
    return {
        product:data.product||'',variant:data.variant||'',products:data.products||[],
        rows:(data.rows||[]).map(row=>({...row,key:crypto.randomUUID()})),
        get variants(){return this.products.find(product=>String(product.id)===String(this.product))?.variants||[];},
        add(){if(this.rows.length<30)this.rows.push({key:crypto.randomUUID(),ingredient_id:'',quantity:''});}
    };
});

Alpine.data('pos',()=>{
    const data=JSON.parse(document.getElementById('pos-data')?.textContent||'{}');
    let customerSearch=0;
    return {
        products:data.products||[],search:'',category:'all',selectedVariants:{},lines:[],
        customer:'',selectedCustomer:null,customerPicker:false,customerQuery:'',customerResults:[],customersBusy:false,customerError:'',discount:'0',received:'',method:'cash',confirmed:false,
        cartOpen:false,error:'',busy:false,key:crypto.randomUUID(),
        money,cents,
        get count(){return this.lines.reduce((sum,line)=>sum+line.quantity,0);},
        get subtotal(){return this.lines.reduce((sum,line)=>sum+line.price*line.quantity,0);},
        get discountCents(){return Math.min(this.subtotal,Math.max(0,cents(this.discount)));},
        get tax(){return Math.round((this.subtotal-this.discountCents)*Number(data.taxRate||0)/100);},
        get total(){return this.subtotal-this.discountCents+this.tax;},
        async findCustomers(){
            const requestId=++customerSearch;
            this.customersBusy=true;this.customerError='';this.customerResults=[];
            try{
                const response=await fetch(data.customerLookupUrl+'?q='+encodeURIComponent(this.customerQuery||''),{headers:{Accept:'application/json'},credentials:'same-origin',signal:AbortSignal.timeout(6000)});
                const body=await response.json();
                if(requestId!==customerSearch)return;
                if(!response.ok)throw new Error();
                this.customerResults=body.customers||[];
            }catch{if(requestId===customerSearch){this.customerError='Pelanggan belum dapat dicari. Coba lagi.';this.customerResults=[];}}
            finally{if(requestId===customerSearch)this.customersBusy=false;}
        },
        chooseCustomer(person){this.selectedCustomer=person;this.customer='';this.customerPicker=false;this.customerQuery='';},
        clearCustomer(){this.selectedCustomer=null;this.customerPicker=false;},
        matches(id){
            const product=this.products.find(p=>p.id===id);
            return product&&(this.category==='all'||String(product.category_id)===this.category)
                &&(product.name+' '+product.sku).toLocaleLowerCase('id').includes(this.search.toLocaleLowerCase('id'));
        },
        add(id){
            if(this.busy)return;
            const product=this.products.find(p=>p.id===id);
            const variant=product.variants.find(v=>v.id===Number(this.selectedVariants[id]));
            const key=id+':'+(variant?.id||'base');
            const current=this.lines.find(line=>line.key===key);
            if(current){
                if(current.quantity<99)current.quantity++;
                else this.error='Kuantitas maksimal 99 per item.';
            }else if(this.lines.length<50){
                this.lines.push({key,product_id:id,variant_id:variant?.id||null,name:product.name,variantName:variant?.name,quantity:1,notes:'',price:cents(product.selling_price)+cents(variant?.price_adjustment)});
            }else this.error='Maksimal 50 baris per pesanan.';
        },
        change(index,step){
            if(this.busy)return;
            const line=this.lines[index];
            if(line.quantity+step>99){this.error='Kuantitas maksimal 99 per item.';return;}
            line.quantity+=step;
            if(line.quantity<=0)this.lines.splice(index,1);
        },
        clearCart(){
            if(this.busy||!this.lines.length)return;
            window.requestConfirmation('Kosongkan semua item dalam keranjang?',()=>{this.lines=[];this.error='';});
        },
        review(){
            this.error='';
            if(!this.lines.length)return;
            if(cents(this.discount)>this.subtotal){this.error='Diskon tidak boleh melebihi subtotal.';return;}
            if(this.method==='cash'&&cents(this.received)<this.total){this.error='Uang diterima belum mencukupi total pembayaran.';return;}
            document.getElementById('checkout-dialog').showModal();
        },
        closeReview(){if(!this.busy)document.getElementById('checkout-dialog').close();},
        async checkout(){
            if(this.busy)return;
            this.busy=true;this.error='';
            try{
                const response=await fetch(data.checkoutUrl,{
                    method:'POST',credentials:'same-origin',
                    headers:{'Content-Type':'application/json','Accept':'application/json','X-CSRF-TOKEN':document.querySelector('meta[name="csrf-token"]').content},
                    body:JSON.stringify({
                        idempotency_key:this.key,customer_id:this.selectedCustomer?.id||null,customer_name:this.selectedCustomer?null:this.customer,
                        discount:String(this.discount||'0'),payment_method:this.method,
                        amount_received:this.method==='cash'?String(this.received||'0'):null,
                        payment_confirmed:this.method!=='cash'&&this.confirmed,
                        items:this.lines.map(line=>({product_id:line.product_id,variant_id:line.variant_id,quantity:line.quantity,notes:line.notes})),
                    }),
                });
                let body={};try{body=await response.json();}catch{}
                if(!response.ok){
                    if(response.status===422)this.error=Object.values(body.errors||{}).flat().join(' ')||'Isian pesanan belum valid.';
                    else if(response.status===401||response.status===419)this.error='Sesi berakhir. Buka login di tab lain, lalu kembali untuk melanjutkan pesanan.';
                    else if(response.status===403)this.error='Akun tidak memiliki izin untuk tindakan ini.';
                    else this.error='Pesanan belum dapat dipastikan tersimpan. Coba lagi dengan pesanan yang sama.';
                    document.getElementById('checkout-dialog').close();
                    return;
                }
                window.location.assign(body.redirect);
            }catch{
                this.error='Koneksi terputus. Coba lagi dengan pesanan yang sama agar transaksi tidak berulang.';
                document.getElementById('checkout-dialog').close();
            }finally{this.busy=false;}
        },
    };
});

Alpine.data('settingsPanel',()=>{
    const data=JSON.parse(document.getElementById('settings-data')?.textContent||'{}');
    return {
        taxEnabled:data.taxEnabled??true,deviceOnline:navigator.onLine,checking:false,connectionMessage:'',latency:null,checkedAt:'',
        init(){
            window.addEventListener('online',()=>{this.deviceOnline=true;});
            window.addEventListener('offline',()=>{this.deviceOnline=false;});
        },
        async checkConnection(){
            if(this.checking)return;
            this.checking=true;this.connectionMessage='';this.latency=null;this.checkedAt='';
            try{
                const response=await fetch(data.connectionUrl,{method:'POST',credentials:'same-origin',headers:{Accept:'application/json','X-CSRF-TOKEN':document.querySelector('meta[name="csrf-token"]').content},signal:AbortSignal.timeout(7000)});
                if(response.status===429){this.connectionMessage='Pemeriksaan terlalu sering. Tunggu satu menit lalu coba lagi.';return;}
                if(!response.ok)throw new Error();
                const result=await response.json();
                this.connectionMessage=result.message;this.latency=result.latency_ms;
                this.checkedAt='Diperiksa '+new Date(result.checked_at).toLocaleString('id-ID');
            }catch{this.connectionMessage='Server POS belum dapat dihubungi. Periksa jaringan atau sesi login, lalu coba lagi.';}
            finally{this.checking=false;}
        },
    };
});

Alpine.data('variantsForm',(initial)=>({
    variants:initial||[],
    add(){if(this.variants.length<8)this.variants.push({name:'',price_adjustment:'0.00'});},
    remove(index){this.variants.splice(index,1);},
}));

const confirmDialog=document.getElementById('confirm-dialog');
let pendingAction=null;
window.requestConfirmation=(message,action)=>{
    if(!confirmDialog)return;
    document.getElementById('confirm-message').textContent=message;
    pendingAction=action;confirmDialog.showModal();
};
document.querySelector('[data-confirm-cancel]')?.addEventListener('click',()=>{confirmDialog.close();pendingAction=null;});
document.querySelector('[data-confirm-accept]')?.addEventListener('click',()=>{
    const action=pendingAction;pendingAction=null;confirmDialog.close();action?.();
});
document.querySelectorAll('form[data-confirm]').forEach(form=>form.addEventListener('submit',event=>{
    if(form.dataset.confirmed==='true')return;
    event.preventDefault();
    window.requestConfirmation(form.dataset.confirm,()=>{form.dataset.confirmed='true';form.requestSubmit();});
}));
document.querySelectorAll('form').forEach(form=>form.addEventListener('submit',event=>{
    if(event.defaultPrevented||event.submitter?.formTarget==='_blank')return;
    form.setAttribute('aria-busy','true');
    form.querySelectorAll('button[type="submit"]').forEach(button=>{button.disabled=true;button.dataset.originalText=button.textContent;button.textContent='Memproses…';});
}));
document.querySelectorAll('[data-theme-toggle]').forEach(button=>button.addEventListener('click',()=>{
    const dark=document.documentElement.classList.toggle('dark');
    try{localStorage.setItem('suwanting-theme',dark?'dark':'light');}catch{}
}));
window.addEventListener('pageshow',()=>{
    document.querySelectorAll('form[aria-busy]').forEach(form=>{
        form.removeAttribute('aria-busy');
        form.querySelectorAll('button[data-original-text]').forEach(button=>{button.disabled=false;button.textContent=button.dataset.originalText;});
    });
});
Alpine.start();
refreshIcons();
