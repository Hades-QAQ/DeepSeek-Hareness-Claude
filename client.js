window.__ModuleLoader__.load({
 id:'dsh-plugin-remote-claude',
 factory(require){
  const React=require('react'), h=React.createElement;
  const id='dsh-plugin-remote-claude',kind='remote-claude-workbench';
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const bridgePath='~/.dsh/profiles/desktop/node_modules/dsh-plugin-remote-claude/bridge.mjs';
  const labels={claude:'接入 Claude',shell:'服务器 Terminal',status:'查看同步状态',push:'本地 → 服务器',pull:'服务器 → 本地',image:'上传剪贴板图片'};
  const inject=['sidebarRight','sidebarRightTabs','slots','webTerminals','workspaces','uiWorkspace'];
  function Guide({useTabInfo}){const {tab}=useTabInfo();return h('button',{onClick:()=>tab.actions.openTab(kind,{replaceTab:true})},'远程 Claude 工作台')}
  function Body({useTabInfo,launch,workspace}){
   const tab=useTabInfo ? useTabInfo().tab : null;
   const [cfg,set]=React.useState(()=>{try{return JSON.parse(localStorage.getItem(workspace ? id+":"+workspace.workspaceId : id))||defaults()}catch{return defaults()}});
   function defaults(){return {host:'',project:workspace?.remoteName || 'my-test',identity:''}}
   const [msg,notify]=React.useState('');
   async function start(op){
    try{if(!/^[\w][\w.@-]*$/.test(cfg.host)||!/^\w[\w-]{0,47}$/.test(cfg.project)||/[\r\n\x00]/.test(cfg.identity))throw Error('请检查主机、工作区名和私钥路径');
     localStorage.setItem(workspace ? id+":"+workspace.workspaceId : id,JSON.stringify(cfg));notify('正在打开终端…');await launch(tab,op,cfg);notify('终端已打开');
    }catch(e){notify(String(e.message||e))}
   }
   return h('section',{className:'dsh-claude-workspace',onPaste:e=>{if([...e.clipboardData.items].some(i=>i.type.startsWith('image/'))){e.preventDefault();void start('image')}}},
    h('small',null,'CLAUDE CODE  /  REMOTE'),h('h2',null,workspace?.title || 'Claude 工作区'),workspace && h('div',null,'本地文件夹　'+workspace.path),
    ...[['host','SSH 用户和主机（也可用本机 SSH 别名）'],['project','远程工作区（每人选自己的名字）'],['identity','本地私钥文件路径（使用 SSH 配置时留空）']].map(([k,t])=>h('label',{key:k},t,h('input',{style:{width:'100%'},value:cfg[k],onChange:e=>set({...cfg,[k]:e.target.value})}))),
    ...Object.entries(labels).map(([op,t])=>h('button',{key:op,onClick:()=>start(op)},t)),
    h('p',null,'Git 使用当前 DSH 项目目录。先在相应终端检查并提交，再快进同步。截图可粘贴到本面板，或点击上传按钮。'),h('output',null,msg));
  }
  function apply(ctx){
   async function launch(session,tab,op,cfg){
    const choices=await ctx.webTerminals.launchShells(session,new AbortController().signal);
    const ps=choices.shells.find(s=>/(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i.test(s.path));if(!ps)throw Error('当前 DSH 环境没有 Windows PowerShell 终端');
    const token=crypto.randomUUID();
    tab.actions.openTab('terminal',{params:{shellPath:ps.path,dshRemoteLaunch:token,dshRemoteOperation:op}});
    for(let n=0;n<150;n++){
     for(const t of ctx.sidebarRight.openTabs.getSnapshot()){
      if(t.sessionId!==session||t.kind!=='terminal')continue;
      const nav=ctx.sidebarRight.tabDomain.occurrence(session,{id:t.tabId}).navigation.getSnapshot();
      if(nav.params?.dshRemoteLaunch!==token)continue;
      const model=ctx.webTerminals.view(session,t.tabId,nav.address,nav.params.terminalId,ps.path);
      if(!model.state.getSnapshot()?.writable)continue;
      const args=[op,cfg.host,cfg.project,cfg.identity];
      model.rename('Claude · '+(op==='shell'?'服务器 Terminal':labels[op])+' · '+cfg.project);
      model.write('node (Resolve-Path '+quote(bridgePath)+') '+args.map(quote).join(' ')+'\r');
      if(op==='claude'){
       const pane=document.querySelector('div[data-sidebar-right-tab="'+CSS.escape(t.tabId)+'"]');
       const target=pane && ctx.sidebarRight.focusedTarget(pane);
       if(target?.sessionId===session && pane.closest('[data-sidebar-right-panel="push"]'))ctx.sidebarRight.toggleFullscreen(target);
       pane?.querySelector('.xterm-helper-textarea')?.focus();
      }
      return;
     }
     await new Promise(r=>setTimeout(r,100));
    }
    throw Error('新终端未就绪，请检查本地 DSH 终端服务。');
   }

   const normalize=p=>p.replaceAll('\\','/').replace(/\/$/,'').toLowerCase();
   const registryKey=id+':folders';
   const readFolders=()=>JSON.parse(localStorage.getItem(registryKey)||'{}');
   const info=w=>{
    if(!w)return;
    const key=normalize(w.path), mapping=readFolders()[key];
    if(!mapping)return;
    return {...w,title:w.title||w.path.split(/[\\/]/).pop(),remoteName:mapping?.remoteName||'my-test'};
   };
   const workspaces=()=>ctx.workspaces.list.getSnapshot().items;
   async function openFolder(ws){
    await ctx.uiWorkspace.openWorkspace(ws.workspaceId);
    for(let i=0;i<120;i++){
     const target=ctx.sidebarRight.commandTarget(null);
     if(target && workspaces().find(w=>w.workspaceId===ws.workspaceId)?.sessionIds.includes(target.sessionId)){
      ctx.sidebarRight.openTabFromTarget(kind,target);return;
     }
     await new Promise(r=>setTimeout(r,100));
    }
    throw Error('本地工作区尚未就绪，请重试');
   }
   let adding=false;
   async function addFolder(){
    if(adding)return;adding=true;
    try{
     const picker=globalThis.__DSH_DIRECTORY_PICKER__;
     const path=await (picker?picker.pick():ctx.uiWorkspace.pickDirectory());
     if(!path)return;
     const ws=workspaces().find(w=>normalize(w.path)===normalize(path))||await ctx.workspaces.create({path});
     const key=normalize(path),map=readFolders();
     if(!map[key]){
      const slug=key.split('/').pop().replace(/[^a-z0-9_-]/g,'-').slice(0,28)||'project';
      map[key]={remoteName:slug+'-'+crypto.randomUUID().slice(0,8)};
      localStorage.setItem(registryKey,JSON.stringify(map));
     }
     refresh();await openFolder(ws);
    }catch(e){window.alert(e.message||String(e))}finally{adding=false}
   }
   let refresh=()=>{};
   const css=document.createElement('style');
   css.textContent=`
    [data-dsh-claude-control=commands]{display:flex;gap:12px;align-items:start;flex:none;padding:6px 10px;color:#d97757;background:#d9775712;font-size:12px}
    [data-dsh-claude-control=commands] summary{cursor:pointer;font-weight:650;list-style:none}
    [data-dsh-claude-control=commands] details[open]{display:grid;gap:5px}
    [data-dsh-claude-control=commands] button{display:block;text-align:left}
    button:has(.dsh-claude-mark),[role=button]:has(.dsh-claude-mark){color:#d97757}
    button:has(.dsh-claude-mark):hover,button[aria-current]:has(.dsh-claude-mark){background:#d9775722}
    .dsh-claude-workspace{--accent:#d97757;box-sizing:border-box;display:grid;align-content:start;gap:12px;padding:clamp(16px,4vw,40px);width:100%;height:100%;overflow:auto;border-top:3px solid var(--accent);background:linear-gradient(145deg,#d977571c,transparent 65%)}
    .dsh-claude-workspace>*{width:100%;max-width:720px;box-sizing:border-box}
    .dsh-claude-workspace h2,.dsh-claude-workspace small{color:var(--accent);margin:0}
    .dsh-claude-workspace small{font-weight:650;letter-spacing:.13em}
    .dsh-claude-workspace label{font-size:13px}
    .dsh-claude-workspace input,.dsh-claude-workspace button{font:inherit;padding:8px 12px;border:1px solid #d9775766;border-radius:8px}
    .dsh-claude-workspace input{display:block;box-sizing:border-box;margin-top:5px;color:inherit;background:#8881}
    .dsh-claude-workspace button{cursor:pointer;color:inherit;background:#d977571a;text-align:left}
    .dsh-claude-workspace button:first-of-type{background:#d97757;color:#201611;font-weight:650}
    .dsh-claude-workspace :focus-visible{outline:2px solid #d97757}
    [data-dockkit-tab]:has(.dsh-claude-tab),[data-dockkit-tab][title^="Claude ·"]{color:#d97757}
   `;
      ctx.effect(()=>{
    const rows=document.createElement('style');
    const makeButton=(label,callback,role)=>{
     const button=document.createElement('button');button.type='button';button.dataset.dshClaudeControl=role;
     button.textContent=label;button.title=label;button.style.cssText='color:#d97757;background:transparent;border:0;cursor:pointer;font:inherit;padding:2px 5px;white-space:nowrap';
     button.onclick=e=>{e.stopPropagation();Promise.resolve(callback()).catch(err=>window.alert(err.message))};
     return button;
    };

    function decorateClaudeTerminals(){
     for(const root of document.querySelectorAll('[data-sidebar-terminal]')){
      if(root.querySelector('[data-dsh-claude-control=commands]'))continue;
      const tabId=root.closest('[data-sidebar-right-tab]')?.dataset.sidebarRightTab;
      const owner=ctx.sidebarRight.openTabs.getSnapshot().find(t=>t.tabId===tabId && t.kind==='terminal');
      if(!owner)continue;
      const navigation=()=>ctx.sidebarRight.tabDomain.occurrence(owner.sessionId,{id:tabId}).navigation.getSnapshot();
      const nav=navigation(),params=nav.params;
      if(params?.dshRemoteOperation!=='claude'||!params.dshRemoteLaunch)continue;
      const bar=document.createElement('div');bar.dataset.dshClaudeControl='commands';
      const menu=document.createElement('details'), summary=document.createElement('summary'),note=document.createElement('span');
      summary.textContent='Claude Code ▾';menu.append(summary);bar.append(menu,note);note.setAttribute('role','status');
      for(const [label,cmd] of [['选择模型','/model'],['历史对话','/resume'],['会话状态','/status']]){
       menu.append(makeButton(label+'  '+cmd,()=>{
        menu.open=false;
        if(navigation().params?.dshRemoteLaunch!==params.dshRemoteLaunch)return;
        const model=ctx.webTerminals.view(owner.sessionId,tabId,nav.address,params.terminalId,params.shellPath);
        const cursor=root.querySelector('.xterm-rows .xterm-cursor');
        const row=cursor?.closest('.xterm-rows > div');
        // Fail closed on SSH prompts, pickers, permission dialogs and non-empty input.
        if(!model.state.getSnapshot()?.writable || !row || !/^❯\s*$/u.test(row.textContent.trim())){
         note.textContent='请在 Claude 空输入提示符处使用；也可直接键入 '+cmd;return;
        }
        model.write(cmd);root.querySelector('.xterm-helper-textarea')?.focus();
        note.textContent='已填入 '+cmd+'，按 Enter 执行';
       },'slash'));
      }
      root.prepend(bar);
     }
    }
    function decorate(){
     decorateClaudeTerminals();
     const add=document.querySelector('button[aria-label="添加工作区"],button[aria-label="Add workspace"]');
     const header=add?.closest('[class*=headerActions]')?.parentElement; if(header && !header.parentElement.querySelector('[data-dsh-claude-control=add]')){const b=makeButton('＋ 添加 Claude 工作区',addFolder,'add');b.style.cssText+=';display:block;margin:2px 12px 6px;text-align:left;flex:none';header.after(b)}
     for(const w of workspaces().filter(info)){
      const row=document.querySelector('[data-row-key="'+CSS.escape('workspace:'+w.workspaceId)+'"]');
      if(row && !row.querySelector('[data-dsh-claude-control=open]'))row.append(makeButton('接入',()=>openFolder(w),'open'));
     }
    }
    refresh=()=>{
     const keys=workspaces().filter(info).flatMap(ws=>['workspace:'+ws.workspaceId,...ws.sessionIds.map(id=>'session:'+id)]);
     const selectors=keys.map(key=>'[data-row-key="'+CSS.escape(key)+'"]');
     rows.textContent=selectors.length ? selectors.map(s=>s+','+s+' svg').join(',')+'{color:#d97757!important}'+selectors.map(s=>s+'[aria-selected=true]').join(',')+'{background:#d9775722!important;box-shadow:inset 2px 0 #d97757}' : '';
    };
    document.head.append(css,rows);refresh();decorate();const off=ctx.workspaces.list.subscribe(()=>{refresh();decorate()});const observer=new MutationObserver(decorate);observer.observe(document.body,{childList:true,subtree:true});
    return ()=>{observer.disconnect();off();document.querySelectorAll("[data-dsh-claude-control]").forEach(el=>el.remove());css.remove();rows.remove()};
   });
   ctx.effect(()=>ctx.sidebarRightTabs.register({id,kind,multiple:true,priority:'builtin',title:()=>'远程 Claude',guide:[{id:'new',order:21,title:()=>'远程 Claude',description:()=>'SSH、Git 和多模态工作区'}]}));
   for(const [name,component] of [['sidebar.right.tab.guide.entry',Guide],['sidebar.right.pane.tab',Body],['sidebar.right.pane.tab.title',()=>h('span',{className:'dsh-claude-tab'},'Claude 工作区')]]){
    ctx.effect(()=>ctx.slots.inject(name,()=>ctx.slots.register({name,key:id,inject:session=>({workspace:info(workspaces().find(w=>w.sessionIds.includes(session))),launch:(...args)=>launch(session,...args)})},component)));
   }
  }
  return {inject,apply};
 }
});
