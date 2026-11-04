window.__ModuleLoader__.load({
 id:'dsh-plugin-remote-claude',
 factory(require){
  const React=require('react'), h=React.createElement;
  const id='dsh-plugin-remote-claude',kind='remote-claude-workbench';
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  const home='~/.dsh/profiles/desktop/node_modules/dsh-plugin-remote-claude';
  const labels={claude:'接入 Claude',shell:'服务器 Terminal',sync:'文件同步 · 选择文件 / 推送 / 拉取',image:'上传剪贴板图片'};
  const inject=['sidebarRight','sidebarRightTabs','slots','webTerminals','workspaces','uiWorkspace'];
  function Guide({useTabInfo}){const {tab}=useTabInfo();return h('button',{onClick:()=>tab.actions.openTab(kind,{replaceTab:true})},'远程 Claude 工作台')}
  async function syncRequest(ctx,session,request,progress){
   const shells=await ctx.webTerminals.launchShells(session,new AbortController().signal);
   const shell=shells.shells.find(s=>/(?:^|[\\/])(?:pwsh|powershell)(?:\.exe)?$/i.test(s.path));
   if(!shell)throw Error('缺少 PowerShell');
   const uid=crypto.randomUUID(),model=ctx.webTerminals.view(session,uid,uid,undefined,shell.path);
   let remaining='',sent=false,revision=-1,buffer='',key='',encoded='',off,unmount,timer;
   try{return await new Promise((resolve,reject)=>{
    timer=setTimeout(()=>reject(Error('读取同步结果超时，请刷新核对仓库状态')),request.action==='push'?1830000:245000);
    function sendChunk(){
     const size=Math.min(2048,(model.state.getSnapshot().environment?.maxInputBytes||2049)-1);
     if(size<1){reject(Error('同步输入通道不可写'));return}
     const chunk=remaining.slice(0,size);remaining=remaining.slice(size);
     model.write(chunk+(remaining?'.':'!'));
    }
    function tick(){
     const state=model.state.getSnapshot();
     if(state.phase==='failed'||state.phase==='closed'){reject(Error(state.error?.message||'DSH 本地同步任务连接中断，请刷新文件列表并核对提交状态'));return}
     const render=state.render;
     if(render && render.revision!==revision){
      revision=render.revision;
      buffer+=(render.frame.data??render.frame.screen??'').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/[\r\n]/g,'');
      let match;
      while((match=/!(READY|ACK|D|END|P):([a-zA-Z0-9+/=]+)!/.exec(buffer))){
       buffer=buffer.slice(match.index+match[0].length);
       if(match[1]==='READY'&&!key){key=match[2];const bytes=new TextEncoder().encode(JSON.stringify(request));let out='';for(const b of bytes)out+=String.fromCharCode(b);remaining=btoa(out);if(remaining.length>4*1024*1024){reject(Error('选择的文件列表过大，请分批推送'));return}sendChunk()}
       else if(key && match[1]==='ACK' && match[2]===key && remaining)sendChunk();
       else if(key && match[1]==='P')progress?.(match[2]);
       else if(key && match[1]==='D')encoded+=match[2];
       else if(key && match[1]==='END' && match[2]===key){
        try{const resp=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))));if(!resp.ok)throw Error(resp.error);resolve(resp.result)}catch(e){reject(e)}
       }
      }
      model.acknowledge(revision);
     }
     if(!sent && state.writable){sent=true;model.write('node (Resolve-Path '+quote(home+'/sync-worker.mjs')+')'+'\r')}
    }
    off=model.state.subscribe(tick);unmount=model.mount();tick();
   })}finally{clearTimeout(timer);off?.();unmount?.();ctx.webTerminals.close(session,uid,uid,model.id)}
  }
  function SyncPanel({rpc,cfg,workspace,back,terminal}){
   const [data,setData]=React.useState({branch:'',changes:[]}),[sel,select]=React.useState(new Set()),[q,filter]=React.useState(''),[msg,message]=React.useState(''),[busy,lock]=React.useState(false),[notice,note]=React.useState(''),[confirm,review]=React.useState('');
   const guard=React.useRef(false);
   const [watch,setWatch]=React.useState(null),[watchError,setWatchError]=React.useState('');
   React.useEffect(()=>{
    let alive=true,pending=false;
    async function read(){if(pending||guard.current)return;pending=true;try{const result=await rpc({...cfg,action:'watch-status'});if(alive){setWatch(result);setWatchError('')}}catch(e){if(alive)setWatchError(e.message)}finally{pending=false}}
    void read();const timer=setInterval(read,15000);return ()=>{alive=false;clearInterval(timer)};
   },[cfg.host,cfg.project,workspace?.path]);
   async function switchWatch(){
    if(guard.current||!watch)return;
    guard.current=true;lock(true);
    try{setWatch(await rpc({...cfg,action:watch.enabled?'watch-off':'watch-on'}));setWatchError('')}
    catch(e){setWatchError(e.message)}finally{guard.current=false;lock(false)}
   }
   const [stage,report]=React.useState(''),[seconds,elapsed]=React.useState(0);
   const startTime=React.useRef(0);
   React.useEffect(()=>{if(!busy)return;const t=setInterval(()=>elapsed(Math.floor((Date.now()-startTime.current)/1000)),1000);return ()=>clearInterval(t)},[busy]);
   const stages={prepare:'准备所选文件',check:'检查服务器',scan:'检查本地变更',commit:'创建本地提交',count:'统计对象',compress:'压缩对象',upload:'上传对象',confirm:'等待服务器确认',refresh:'刷新文件列表'};
   const parts=/^([a-z]+)(\d+)?$/.exec(stage);
   async function act(action){
    if(guard.current)return;guard.current=true;lock(true);review('');note('正在处理…');
    startTime.current=Date.now();elapsed(0);if(action==='push')report('prepare');
    try{let result=action==='list'?'':await rpc({...cfg,action,files:[...sel],message:msg},report);if(action==='push')report('refresh');
     const list=await rpc({...cfg,action:'list'});setData(list);select(new Set());note(result||'');
    }catch(e){note(String(e.message||e))}finally{report('');guard.current=false;lock(false)}
   }
   React.useEffect(()=>{void act('list')},[]);
   const visible=data.changes.filter(x=>x.file.toLowerCase().includes(q.toLowerCase()));
   const button=(text,fn,disabled=false)=>h('button',{type:'button',onClick:fn,disabled:busy||disabled},text);
   const toggle=(paths,on)=>select(prev=>{const next=new Set(prev);for(const p of paths){if(on)next.add(p);else next.delete(p)}return next});
   return h('section',{className:'dsh-sync-pane'},
    h('header',null,button('‹ 工作台',back),h('strong',null,'文件同步'),button('打开本地终端',terminal)),
    h('div',{className:'sync-meta'},workspace?.path,' · '+(data.branch||'…'),h('br'),cfg.host+'  ~/projects/'+cfg.project),
    h('input',{placeholder:'按文件路径筛选',value:q,onChange:e=>filter(e.target.value)}),
    h('div',{className:'sync-line'},h('span',null,visible.length+' 项 · 已选 '+sel.size),button('刷新',()=>act('list')),button('全选全部 '+data.changes.length+' 项',()=>toggle(data.changes.map(x=>x.file),true)),button('选择筛选结果',()=>toggle(visible.map(x=>x.file),true)),button('清空选择',()=>select(new Set()))),
    h('label',{className:'sync-meta'},h('input',{type:'checkbox',checked:!!watch?.enabled,disabled:busy||!watch,onChange:switchWatch}),' 自动回传服务器文件（无需提交，关闭面板后继续）'),
    h('small',null,watchError || (watch?.enabled?'服务器 → 本地 · '+watch.status+' · 冲突 '+watch.conflicts:'首次开启会同步远端已有文件；两边独立修改同一文件时保留冲突。')),
    h('div',{className:'sync-files'},visible.map(x=>h('label',{key:x.file,title:x.file},h('input',{type:'checkbox',checked:sel.has(x.file),disabled:busy,onChange:e=>toggle([x.file],e.target.checked)}),h('small',null,x.status==='??'?'新增':x.status.trim()),h('span',null,x.file)))),
    h('input',{placeholder:'提交说明（勾选文件时必填）',value:msg,onChange:e=>message(e.target.value)}),
    confirm?h('div',null,h('p',null,confirm==='push'?'确认远程 Claude 已空闲。将推送当前分支已有提交和勾选的 '+sel.size+' 个文件。':'将远程分支快进合并到当前本地分支。'),button('取消',()=>review('')),button('确认'+(confirm==='push'?'推送':'拉取'),()=>act(confirm))):h('footer',null,button('拉取远程提交',()=>review('pull')),button('推送到服务器',()=>review('push'),sel.size>0&&!msg.trim())),
    parts && h('div',{role:'status'},h('div',null,stages[parts[1]],' · ',seconds,' 秒',parts[2]?' · '+parts[2]+'%':''),h('progress',{max:100,...(parts[2]?{value:Number(parts[2])}:{}),style:{width:'100%',accentColor:'#d97757'}})),
    h('output',{role:'status'},notice));
  }

  function Body({useTabInfo,launch,workspace,rpc}){
   const tab=useTabInfo ? useTabInfo().tab : null;
   const [cfg,set]=React.useState(()=>{try{return JSON.parse(localStorage.getItem(workspace ? id+":"+workspace.workspaceId : id))||defaults()}catch{return defaults()}});
   function defaults(){return {host:'',project:workspace?.remoteName || 'my-test',identity:''}}
   const [msg,notify]=React.useState('');
   const [syncOpen,showSync]=React.useState(false);
   if(syncOpen)return h(SyncPanel,{rpc,cfg,workspace,back:()=>showSync(false),terminal:()=>tab.actions.openTab('terminal',{})});
   async function start(op){
    try{if(!/^[\w][\w.@-]*$/.test(cfg.host)||!/^\w[\w-]{0,47}$/.test(cfg.project)||/[\r\n\x00]/.test(cfg.identity))throw Error('请检查主机、工作区名和私钥路径');
     localStorage.setItem(workspace ? id+":"+workspace.workspaceId : id,JSON.stringify(cfg));if(op==='sync'){showSync(true);return}notify('正在打开终端…');await launch(tab,op,cfg);notify('终端已打开');
    }catch(e){notify(String(e.message||e))}
   }
   return h('section',{className:'dsh-claude-workspace',onPaste:e=>{if([...e.clipboardData.items].some(i=>i.type.startsWith('image/'))){e.preventDefault();void start('image')}}},
    h('small',null,'CLAUDE CODE  /  REMOTE'),h('h2',null,workspace?.title || 'Claude 工作区'),workspace && h('div',null,'本地文件夹　'+workspace.path),
    ...[['host','SSH 用户和主机（也可用本机 SSH 别名）'],['project','远程工作区（每人选自己的名字）'],['identity','本地私钥文件路径（使用 SSH 配置时留空）']].map(([k,t])=>h('label',{key:k},t,h('input',{style:{width:'100%'},value:cfg[k],onChange:e=>set({...cfg,[k]:e.target.value})}))),
    ...Object.entries(labels).map(([op,t])=>h('button',{key:op,onClick:()=>start(op)},t)),
    h('p',null,'点击「文件同步」勾选本地文件并提交推送，或拉取远程提交。截图可粘贴到本面板，或点击上传按钮。'),h('output',null,msg));
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
      model.write('node (Resolve-Path '+quote(home+'/bridge.mjs')+') '+args.map(quote).join(' ')+'\r');
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
    .dsh-sync-pane{box-sizing:border-box;height:100%;min-height:0;display:flex;flex-direction:column;gap:8px;padding:14px;color:inherit;overflow:auto}
    .dsh-sync-pane header,.dsh-sync-pane footer,.sync-line{display:flex;align-items:center;flex-wrap:wrap;gap:8px}.dsh-sync-pane header strong{flex:1;color:#d97757}.sync-meta,.dsh-sync-pane output{font-size:12px;overflow-wrap:anywhere}.dsh-sync-pane output{white-space:pre-wrap}
    .dsh-sync-pane button,.dsh-sync-pane>input{color:inherit;background:#8881;border:1px solid #8885;border-radius:6px;padding:5px 9px}.dsh-sync-pane button{cursor:pointer}.dsh-sync-pane button:disabled{opacity:.5}.dsh-sync-pane footer button:last-child{background:#d97757;color:#201611}
    .sync-files{flex:1;min-height:100px;overflow:auto;border-block:1px solid #8884}.sync-files label{display:flex;align-items:center;gap:8px;padding:4px}.sync-files label:hover{background:#8882}.sync-files input{accent-color:#d97757}.sync-files small{color:#d97757}.sync-files span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

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
    ctx.effect(()=>ctx.slots.inject(name,()=>ctx.slots.register({name,key:id,inject:session=>({rpc:(req,progress)=>syncRequest(ctx,session,req,progress),workspace:info(workspaces().find(w=>w.sessionIds.includes(session))),launch:(...args)=>launch(session,...args)})},component)));
   }
  }
  return {inject,apply};
 }
});
