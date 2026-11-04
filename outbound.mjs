export function outboundText(messages){
 const turn=messages.slice(messages.findLastIndex(m=>m.role==='assistant'||m.role==='tool')+1);
 const inputs=turn.filter(m=>m.role==='user' && m.source?.kind==='user');
 if(inputs.length!==1 || !inputs[0].source.rpcId?.trim?.())
  throw Error('无法唯一识别本轮手动发送的消息，已暂停转发。');
 const blocks=inputs[0].content;
 if(!Array.isArray(blocks)||!blocks.length||blocks.some(b=>b?.type!=='text'||typeof b.text!=='string'))
  throw Error('本轮含非文本内容，已暂停转发。图片请通过工作台上传。');
 const text=blocks.map(b=>b.text).join('\n');
 if(!text.trim()||/[\x00-\x08\x0b-\x1f\x7f]/.test(text))throw Error('消息为空或包含终端控制字符，已暂停转发。');
 if(/^[\/!]/.test(text.trimStart()))throw Error('命令请在右侧 Claude 终端执行。');
 return text;
}
