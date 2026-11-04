import sys, os, json, subprocess, time, re, fcntl, hashlib
from pathlib import Path

def tmux(*args, data=None):
    return subprocess.check_output(["tmux", *args], input=data).decode().strip()

def emit(**event):
    print(json.dumps(event), flush=True)

def run():
    req=json.load(sys.stdin)
    target=req["session"]+":"
    pane,pid,cmd=tmux("display-message","-p","-t",target,"#{pane_id} #{pane_pid} #{pane_current_command}").split()
    if cmd!="claude": raise ValueError("请先在右侧接入 Claude Code。")
    home=Path.home()
    statefile=home/".claude/sessions"/(pid+".json")
    state=json.loads(statefile.read_text())
    cwd=Path(state["cwd"]).resolve()
    if cwd!=(home/"projects"/req["project"]).resolve(): raise ValueError("终端所在项目已切换，请重新接入。")
    lockdir=home/".local/state/dsh-remote"
    lockdir.mkdir(mode=0o700,parents=True,exist_ok=True)
    lock=(lockdir/(req["session"]+".lock")).open("a")
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if state.get("status")!="idle": raise ValueError("Claude 正忙，请查看右侧终端后重试。")
    session=state["sessionId"]
    if not re.fullmatch(r"[a-fA-F0-9-]{36}",session): raise ValueError("无效会话标识")
    log=home/".claude/projects"/re.sub(r"[^a-zA-Z0-9]","-",str(cwd))/(session+".jsonl")
    if not log.exists():
        matches=list((home/".claude/projects").glob("*/"+session+".jsonl"))
        if matches: log=matches[0]
    offset=log.stat().st_size if log.exists() else 0
    prompt=req["text"]
    if not prompt.strip() or any(ord(c)<32 and c not in "\n\t" for c in prompt): raise ValueError("仅支持普通文本")
    if prompt.lstrip().startswith(("/","!")): raise ValueError("斜杠命令和 Shell 命令请在右侧终端执行。")
    raw_screen=tmux("capture-pane","-e","-p","-t",pane)
    # Dim text after the prompt is Claude's suggestion, not typed input.
    clean_screen=re.sub(r"(❯\s*)\x1b\[2m[^\n]*",r"\1",raw_screen)
    line=re.sub(r"\x1b\[[0-9;]*m","",clean_screen).splitlines()
    editor=next((s.strip()[1:].strip() for s in reversed(line) if s.strip().startswith("❯")),None)
    if editor is None or (editor and not editor.startswith('Try "')): raise ValueError("右侧输入框有草稿或正等待确认，请先处理。")
    name="dshchat-"+pid
    tmux("load-buffer","-b",name,"-",data=prompt.encode())
    tmux("paste-buffer","-d","-p","-b",name,"-t",pane)
    time.sleep(.25)
    tmux("send-keys","-t",pane,"Enter")
    accepted=False
    start=time.monotonic()
    seen=set()
    while time.monotonic()-start<1800:
        if not Path("/proc",pid).exists(): raise ValueError("右侧 Claude 进程已退出")
        if log.exists():
            with log.open("rb") as f:
                f.seek(offset)
                for raw in f:
                    if not raw.endswith(b"\n"): break
                    offset+=len(raw)
                    item=json.loads(raw)
                    msg=item.get("message",{})
                    blocks=msg.get("content",[])
                    if item.get("type")=="user" and isinstance(blocks,str):
                        if accepted: raise ValueError("检测到终端发起了另一轮，请在右侧查看。")
                        if blocks.strip()==prompt.strip(): accepted=True
                    if not accepted or item.get("type")!="assistant": continue
                    uid=item.get("uuid")
                    if uid and uid in seen: continue
                    seen.add(uid)
                    for block in blocks:
                        if block.get("type")=="text": emit(text=block["text"])
                    if msg.get("stop_reason") in ("end_turn","stop_sequence","max_tokens"):
                        emit(done=True);return
        if not accepted and time.monotonic()-start>25: raise ValueError("未能确认输入已被 Claude 接收，请看右侧终端，避免重复发送。")
        time.sleep(.18)
    raise ValueError("等待回复超时，请查看右侧终端")
try: run()
except Exception as e:
    emit(error=str(e));sys.exit(1)
