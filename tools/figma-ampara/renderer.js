// Native, editable Figma screens. The caller supplies an existing foundation state.
async function renderAmparaScreens(figma, input) {
  const { state, screens, viewport, pageId, assets } = input;
  const mobile = viewport === 'mobile';
  const page = await figma.getNodeByIdAsync(pageId);
  await figma.setCurrentPageAsync(page);
  await Promise.all(state.fonts.map(font => figma.loadFontAsync(font)));
  const colors = {}, styles = {}, components = {};
  for (const [key, id] of Object.entries(state.colors)) colors[key] = await figma.variables.getVariableByIdAsync(id);
  for (const [key, id] of Object.entries(state.styles)) styles[key] = await figma.getStyleByIdAsync(id);
  for (const [key, id] of Object.entries(state.components)) components[key] = await figma.getNodeByIdAsync(id);
  const palette = { navy:'#183b68',blue:'#4679ee',deep:'#102747',background:'#f3f2ed',surface:'#fffefa',white:'#ffffff',text:'#24364f',muted:'#526e91',border:'#dfe6f0',soft:'#edf3fc',success:'#087a58',successBg:'#e9f9f2',warning:'#935e0c',warningBg:'#fff6e5',danger:'#bf3c59',dangerBg:'#fff0f3',info:'#365ac0',infoBg:'#edf2ff',heroMuted:'#c2d2e6' };
  const created = [], links = [], frames = {}, bounds = [];let currentScreen;
  const rgb = hex => ({r:parseInt(hex.slice(1,3),16)/255,g:parseInt(hex.slice(3,5),16)/255,b:parseInt(hex.slice(5,7),16)/255});
  const paint = key => figma.variables.setBoundVariableForPaint({type:'SOLID',color:rgb(palette[key] || palette.text)},'color',colors[key] || colors.text);
  const fill = (node,key) => { node.fills = key ? [paint(key)] : []; };
  const track = node => { created.push(node.id); return node; };
  const add = (parent,child) => { parent.appendChild(child); return child; };
  function box(name, direction, width, padding=0, gap=0, background, radius=0) {
    const n=track(figma.createAutoLayout(direction)); n.name=name; n.resize(width,1);
    n.primaryAxisSizingMode=direction==='HORIZONTAL'?'FIXED':'AUTO';
    n.counterAxisSizingMode=direction==='HORIZONTAL'?'AUTO':'FIXED';
    n.paddingTop=n.paddingBottom=n.paddingLeft=n.paddingRight=padding;
    n.itemSpacing=gap; n.clipsContent=false; fill(n,background); n.cornerRadius=radius;
    return n;
  }
  function txt(value,width,role='body',color='text',name) {
    const n=track(figma.createText()); n.name=name || String(value).slice(0,70);
    n.fontName=styles[role].fontName; n.textStyleId=styles[role].id; n.characters=String(value ?? '');
    n.textAutoResize='HEIGHT'; n.resize(Math.max(1,width),styles[role].lineHeight.value); fill(n,color); return n;
  }
  function panel(name,width,padding=mobile?20:24) {
    const n=box(name,'VERTICAL',width,padding,20,'surface',24);n.strokes=[paint('border')];n.strokeWeight=1;n.effectStyleId=state.effect;return n;
  }
  function instance(key,width) {
    if(!components[key])throw new Error('Componente ausente: '+key);
    const n=track(components[key].createInstance());
    if(width&&key.startsWith('hero/'))n.rescale(width/n.width);
    else if(width){n.resize(width,n.height);n.primaryAxisSizingMode=n.layoutMode==='HORIZONTAL'?'FIXED':'AUTO';n.counterAxisSizingMode=n.layoutMode==='HORIZONTAL'?'AUTO':'FIXED';}
    return n;
  }
  function go(node,to){if(to)links.push({nodeId:node.id,to,viewport});return node;}
  function button(action,maxWidth) {
    const key='button/'+(action.variant || 'primary')+'/default';
    const width=Math.min(maxWidth,Math.max(128,String(action.label).length*8.4+40));
    const n=instance(key,width);n.name='Ação · '+action.label;n.setProperties({[state.properties[key].label]:action.label});return go(n,action.to);
  }
  function badge(value,tone='neutral',maxWidth=200) {
    const key='badge/'+(['success','warning','danger','info'].includes(tone)?tone:'neutral');
    const n=instance(key,Math.max(36,Math.min(maxWidth,String(value).length*6.3+22)));
    n.setProperties({[state.properties[key].label]:String(value)});return n;
  }
  function field(data,width) {
    const type=['search','select','date','textarea','file'].includes(data.type)?data.type:'text';const key='field/'+type;
    const n=instance(key,width);n.name='Campo · '+data.label;
    n.setProperties({[state.properties[key].label]:data.label+(data.required?' *':''),[state.properties[key].value]:String(data.value ?? '')});return n;
  }
  function icon(name,size=20) {const n=instance('icon/'+(components['icon/'+name]?name:'FileText'));n.rescale(size/n.width);return n;}
  function logo(width=116,compact=false) {
    const data=compact?assets.icon:assets.logo;const n=track(figma.createRectangle());n.name=compact?'Ícone original Ampara':'Logo original Ampara';
    n.resize(width,width*data.height/data.width);n.fills=[{type:'IMAGE',imageHash:compact?state.iconHash:state.logoHash,scaleMode:'FIT'}];return n;
  }
  function actionList(parent,values,width) {
    if(!values?.length)return;
    const group=add(parent,box('Ações','VERTICAL',width,0,8));let row,used=0;
    for(const action of values){const child=button(action,width);if(!row || mobile || used+child.width>width){row=add(group,box('Linha de ações','HORIZONTAL',width,0,8));used=0;}add(row,child);used+=child.width+8;}
  }
  function grid(parent,items,columns,width,gap,render) {
    const cw=(width-gap*(columns-1))/columns;
    for(let i=0;i<items.length;i+=columns){const row=add(parent,box('Linha','HORIZONTAL',width,0,gap));for(const item of items.slice(i,i+columns))add(row,render(item,cw));}
  }
  function detail(item,width){const n=box(item.label,'VERTICAL',width,0,6);add(n,txt(item.label,width,'caption','muted'));add(n,txt(item.value,width));return n;}
  function cell(value,width) {
    const n=box('Célula','VERTICAL',width,0,5);
    if(typeof value==='object'){
      if(value.badge)add(n,badge(value.badge,value.tone,width));
      if(!value.badge || value.text!==value.badge)add(n,txt(value.text,width,'body'));
      if(value.sub)add(n,txt(value.sub,width,'caption','muted'));
    }else add(n,txt(value,width));return n;
  }
  function section(parent,data,width) {
    if(data.type==='notice'){
      const tone=['warning','danger','success'].includes(data.tone)?data.tone:'info';
      const n=add(parent,box('Aviso','HORIZONTAL',width,16,12,tone+'Bg',16));add(n,icon(tone==='warning'?'TriangleAlert':'CircleAlert'));add(n,txt(data.text,width-64,'small',tone));return;
    }
    if(data.type==='stats'){
      grid(parent,data.items,mobile?2:data.items.length,width,16,(item,cw)=>{const n=panel('Indicador · '+item.label,cw,20);if(item.icon)add(n,icon(item.icon));add(n,txt(item.label,cw-40,'caption','muted'));add(n,txt(item.value,cw-40,'metric','navy'));if(item.detail)add(n,txt(item.detail,cw-40,'small','muted'));return n;});return;
    }
    const n=add(parent,panel(data.title || 'Conteúdo',width));const iw=width-(mobile?40:48);
    if(data.title)add(n,txt(data.title,iw,'h3','navy'));
    if(data.type==='form'){
      grid(n,data.fields,mobile||currentScreen==='login'?1:Math.min(3,data.fields.length),iw,16,(item,cw)=>field(item,cw));actionList(n,data.actions,iw);
    }else if(data.type==='details'){
      grid(n,data.items,mobile?1:3,iw,24,(item,cw)=>detail(item,cw));actionList(n,data.actions,iw);
    }else if(data.type==='empty'){
      add(n,icon('FolderOpen',28));if(data.text)add(n,txt(data.text,iw,'body','muted'));
    }else if(data.type==='cards'){
      if(currentScreen==='login'){
        grid(n,data.items,mobile?1:2,iw,16,(item,cw)=>button({...item.action,label:item.title,variant:'secondary'},cw));return;
      }
      grid(n,data.items,mobile?1:Math.min(3,data.items.length),iw,16,(item,cw)=>{
        const c=panel(item.title,cw,20),inner=cw-40;
        if(item.status)add(c,badge(item.status,item.tone,inner));add(c,txt(item.title,inner,'h3','navy'));
        if(item.subtitle)add(c,txt(item.subtitle,inner,'caption','muted'));
        if(item.description)add(c,txt(item.description,inner,'small','muted'));
        if(item.meta)for(const m of item.meta)add(c,detail(m,inner));
        if(item.action)add(c,button({...item.action,variant:'secondary'},inner));return c;
      });
    }else if(data.type==='timeline'){
      for(const item of data.items){const row=add(n,box('Evento','HORIZONTAL',iw,0,16));const dot=add(row,box('Marcador','VERTICAL',8,4,0,'blue',4));dot.minHeight=8;
        const body=add(row,box(item.title,'VERTICAL',iw-24,0,6));add(body,txt(item.title,iw-24,'strong','navy'));if(item.detail)add(body,txt(item.detail,iw-24,'small','muted'));if(item.date)add(body,txt(item.date,iw-24,'caption','muted'));}
    }else if(data.type==='table'){
      if(mobile){
        for(const row of data.rows){const c=add(n,panel('Registro',iw,16));const cw=iw-32;for(let i=0;i<data.columns.length;i++){add(c,txt(data.columns[i],cw,'eyebrow','muted'));add(c,cell(row.cells[i] ?? '—',cw));}if(row.to)add(c,button({label:'Consultar detalhes',variant:'secondary',to:row.to},cw));}
      }else{
        const weights=data.columns.map((_,i)=>i===0?1.7:1);const unit=(iw-16*(weights.length-1))/weights.reduce((a,b)=>a+b,0);
        const head=add(n,box('Cabeçalho da tabela','HORIZONTAL',iw,0,16));data.columns.forEach((label,i)=>add(head,txt(label.toUpperCase(),unit*weights[i],'eyebrow','muted')));
        for(const row of data.rows){const r=add(n,box('Registro','HORIZONTAL',iw,0,16));r.paddingTop=r.paddingBottom=14;r.strokes=[paint('border')];r.strokeTopWeight=1;r.strokeBottomWeight=r.strokeLeftWeight=r.strokeRightWeight=0;
          row.cells.forEach((value,i)=>add(r,cell(value,unit*weights[i])));go(r,row.to);}
      }
    }
  }
  function topbar(root,width,login) {
    const row=add(root,box('Cabeçalho Ampara','HORIZONTAL',width,0,20));row.counterAxisAlignItems='CENTER';
    if(!mobile&&!login)add(row,go(logo(36,true),'overview'));
    add(row,go(logo(mobile?110:116),'overview'));
    const spacer=add(row,box('Espaço flexível','VERTICAL',1));spacer.layoutSizingHorizontal='FILL';
    if(!mobile&&!login){
      const unit=add(row,box('Unidade de trabalho','HORIZONTAL',190,12,12,'surface',16));add(unit,txt('Unidade Matriz',138,'strong','navy'));add(unit,icon('ChevronDown',16));
      const search=add(row,box('Busca global','HORIZONTAL',260,12,12,'surface',16));add(search,icon('Search',20));add(search,txt('O que você procura?',202,'small','muted'));go(search,'navigation');
    }
    if(!login){for(const [name,to]of [['Bell','notifications'],['Menu','navigation']]){const b=add(row,box(name,'HORIZONTAL',44,12,0,'surface',16));b.primaryAxisAlignItems='CENTER';add(b,icon(name,20));go(b,to);}}
  }
  function rail(parent,active) {
    const n=add(parent,box('Navegação rápida','VERTICAL',72,14,8,'surface',30));
    for(const [name,to]of [['LayoutDashboard','overview'],['ShieldCheck','inspections'],['HeartPulse','asos'],['HardHat','epis'],['ChartNoAxesCombined','readiness'],['Menu','navigation']]){
      const b=add(n,box(to,'HORIZONTAL',44,12,0,to===active?'soft':null,14));add(b,icon(name,20));go(b,to);
    }return n;
  }
  const width=mobile?390:1440,outerPad=mobile?20:32,available=width-outerPad*2;
  const startY=Math.max(0,...page.children.filter(n=>'height'in n).map(n=>n.y+n.height))+160;
  for(let index=0;index<screens.length;index++){
    const data=screens[index];currentScreen=data.id;
    if(page.children.some(n=>n.name==='Tela/'+viewport+'/'+data.id))throw new Error('Tela já existe: '+data.id);
    const root=add(page,box('Tela/'+viewport+'/'+data.id,'VERTICAL',width,outerPad,mobile?20:24,'background',mobile?24:0));
    root.x=160+index*(width+80);root.y=startY;root.minHeight=mobile?844:960;
    const login=data.id==='login';topbar(root,available,login);
    const body=add(root,box('Espaço de trabalho','HORIZONTAL',available,0,mobile?0:28));
    if(!mobile&&!login)rail(body,data.id);
    const cw=login?(mobile?available:540):mobile?available:available-100;
    if(login&&!mobile){body.primaryAxisAlignItems='CENTER';}
    const content=add(body,box('Conteúdo principal','VERTICAL',cw,0,mobile?20:24));
    if(!login){const demo=add(content,box('Ambiente de demonstração','HORIZONTAL',cw,12,8,'surface',12));add(demo,txt('DEMONSTRAÇÃO · Dados fictícios em memória. Integração com API pendente.',cw-24,'caption','muted'));}
    const hero=Boolean(data.hero),header=add(content,box('Apresentação','VERTICAL',cw,mobile?24:30,16,hero?'navy':'surface',hero?28:24));const hw=cw-(mobile?48:60);
    const sideActions=!hero&&!mobile&&data.actions?.length;
    const actionWidth=sideActions?Math.min(420,Math.max(...data.actions.map(a=>a.label.length*8.4+40))):0;
    const headingRow=add(header,box('Título e ilustração','HORIZONTAL',hw,0,24));headingRow.counterAxisAlignItems='CENTER';
    const textWidth=hero&&!mobile?hw-304:sideActions?hw-actionWidth-24:hw;
    const heading=add(headingRow,box('Identificação','VERTICAL',textWidth,0,12));
    add(heading,txt(data.eyebrow || data.family || 'AMPARA SESMT',textWidth,'eyebrow',hero?'heroMuted':'muted'));
    add(heading,txt(data.title,textWidth,mobile?'h1':hero?'hero':'h1',hero?'surface':'navy'));
    if(data.description)add(heading,txt(data.description,textWidth,'body',hero?'heroMuted':'muted'));
    if(hero&&!mobile)add(headingRow,instance('hero/'+data.hero,280));
    if(hero&&mobile){const art=add(header,instance('hero/'+data.hero,220));art.counterAxisAlignItems='CENTER';}
    actionList(sideActions?headingRow:header,(data.actions || []).map(a=>hero?{...a,variant:'secondary'}:a),sideActions?actionWidth:hw);
    if(data.tabs?.length){const tabs=add(content,box('Abas','VERTICAL',cw,0,8));let row,used=0;for(const tab of data.tabs){const b=button({label:tab.label,variant:tab.selected?'primary':'secondary',to:tab.to},cw);if(!row || used+b.width>cw){row=add(tabs,box('Linha de abas','HORIZONTAL',cw,0,8));used=0;}add(row,b);used+=b.width+8;}}
    for(const part of data.sections)section(content,part,cw);
    add(content,txt('Ampara SESMT · Segurança que acompanha você.',cw,'caption','muted'));
    frames[data.id]=root.id;
    const tree=root.findAll();for(const n of tree)if(!created.includes(n.id))created.push(n.id);
    bounds.push({id:root.id,screen:data.id,width:root.width,height:root.height,x:root.x,y:root.y});
  }
  return {pageId,viewport,frames,bounds,links,createdNodeIds:created,mutatedNodeIds:[pageId],textCount:created.length,screenCount:screens.length};
}
