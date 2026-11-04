import path from 'node:path';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

export function returnFiles(action,{host,project,identity}){
 if(!/^[\w][\w.@-]*$/.test(host)||!/^\w[\w-]{0,47}$/.test(project))throw Error('工作区连接信息无效');
 const destination=path.resolve('.');
 const name='dsh-'+createHash('sha256').update(JSON.stringify([destination.toLowerCase(),host,project])).digest('hex').slice(0,24);
 const exe=fileURLToPath(new URL('./mutagen/mutagen.exe',import.meta.url));
 const program=existsSync(exe)?exe:'mutagen.exe';
 const env={...process.env,MUTAGEN_DATA_DIRECTORY:path.join(process.env.LOCALAPPDATA,'DSH-Remote-Claude','mutagen')};
 function run(args){
  const r=spawnSync(program,['sync',...args],{env,encoding:'utf8',windowsHide:true,timeout:90000});
  if(r.error?.code==='ENOENT')throw Error('请先安装 Mutagen 并将 mutagen.exe 加入 PATH，然后重启 DSH。');
  if(r.error||r.status!==0)throw Error(r.error?.message||r.stderr.trim()||'同步服务调用失败');
  return r.stdout.trim();
 }
 function state(){
  const sessions=JSON.parse(run(['list','--label-selector','workspace='+name,'--template','{{json .}}'])||'null')||[];
  if(sessions.length>1)throw Error('检测到重复的同步任务，请先检查。');
  const session=sessions[0];
  return {enabled:!!session&&!session.paused,status:session?.status||'未开启',conflicts:session?.conflicts?.length||0,paused:!!session?.paused};
 }
 const previous=state();
 if(action==='watch-on'&&!previous.enabled){
  if(identity)throw Error('后台同步使用系统 OpenSSH。请把专用私钥配置到 SSH 别名，并在工作区中使用该别名。');
  if(previous.paused)run(['resume',name]);
  else run(['create','--no-global-configuration','--name',name,'--label','workspace='+name,'--mode','one-way-safe','--ignore-vcs','--symlink-mode','ignore','--ignore','node_modules','--ignore','__pycache__','--ignore','.venv','--ignore','.env','--ignore','.env.*',host+':projects/'+project,destination]);
 }else if(action==='watch-off'&&previous.enabled)run(['pause',name]);
 return state();
}
