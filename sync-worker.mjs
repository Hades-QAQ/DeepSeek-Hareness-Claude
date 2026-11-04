import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
// One request per dedicated DSH PTY. Wait for an explicit frame before reading input.
const key=randomUUID().replaceAll('-','');
process.stdin.setRawMode(true);
process.stdin.setEncoding('ascii');
let payload='';
process.stdout.write('!READY:'+key+'!\r\n');
process.stdin.on('data',part=>{
 payload+=part;
 if(payload.length>4*1024*1024)process.exit(1);
 if(payload.endsWith('.')){
  payload=payload.slice(0,-1);process.stdout.write('!ACK:'+key+'!\r\n');return;
 }
 if(!payload.includes('!'))return;
 process.stdin.pause();
 const input=Buffer.from(payload.split('!')[0],'base64');
 const r=spawnSync(process.execPath,[fileURLToPath(new URL('./sync.mjs',import.meta.url))],{input,maxBuffer:32*1024*1024,timeout:1800000,stdio:['pipe','pipe',2],env:{...process.env,DSH_PROGRESS:'1'}});
 const result=r.stdout?.length?r.stdout:Buffer.from(JSON.stringify({ok:false,error:r.error?.message||'Git 同步进程未返回结果'}));
 const encoded=result.toString('base64');
 for(let i=0;i<encoded.length;i+=48)process.stdout.write('!D:'+encoded.slice(i,i+48)+'!\r\n');
 process.stdout.write('!END:'+key+'!\r\n',()=>process.exit(0));
});
