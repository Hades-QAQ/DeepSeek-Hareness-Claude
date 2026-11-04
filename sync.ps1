Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$OutputEncoding=[Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding=$OutputEncoding
function Invoke-Sync($action,$files=@(),$message=''){
 $json=@{action=$action;host=$env:DSH_SYNC_HOST;project=$env:DSH_SYNC_PROJECT;identity=$env:DSH_SYNC_IDENTITY;files=@($files);message=$message}|ConvertTo-Json -Compress -Depth 4
 $raw=$json | & node (Join-Path $PSScriptRoot 'sync.mjs')
 $reply=$raw|ConvertFrom-Json
 if(!$reply.ok){throw ($reply.error | Out-String)}
 return $reply.result
}
[Windows.Forms.Application]::EnableVisualStyles()
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class SyncWindow { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); [DllImport("dwmapi.dll")] public static extern int DwmSetWindowAttribute(System.IntPtr h, int a, ref int v, int n); }'
[void][SyncWindow]::SetProcessDPIAware()
$bg='#1C1B1A';$surface='#272624';$ink='#F4EFE9';$muted='#C2B8AF';$accent='#D97757'
$f=New-Object Windows.Forms.Form
$f.Font=New-Object Drawing.Font('Microsoft YaHei UI',10)
$f.BackColor=$bg;$f.ForeColor=$ink;$f.AutoScaleMode='Dpi';$f.ShowIcon=$false
[int]$dark=1;[void][SyncWindow]::DwmSetWindowAttribute($f.Handle,20,[ref]$dark,4)
$f.Text='Claude 工作区 · Git 同步';$f.Size=New-Object Drawing.Size(850,670);$f.MinimumSize=New-Object Drawing.Size(760,580);$f.StartPosition='CenterScreen'
$layout=New-Object Windows.Forms.TableLayoutPanel;$layout.Dock='Fill';$layout.Padding=20;$layout.ColumnCount=1;$layout.RowCount=10
foreach($height in @(40,48,23,33,25,0,23,35,47,42)){$style=New-Object Windows.Forms.RowStyle;if($height){$style.SizeType='Absolute';$style.Height=$height}else{$style.SizeType='Percent';$style.Height=100};[void]$layout.RowStyles.Add($style)}
$f.Controls.Add($layout)
function Row($control,$i){$control.Dock='Fill';$layout.Controls.Add($control,0,$i)}
$info=New-Object Windows.Forms.Label;Row $info 1
$search=New-Object Windows.Forms.TextBox;Row $search 3
$list=New-Object Windows.Forms.ListView;$list.View='Details';$list.CheckBoxes=$true;$list.FullRowSelect=$true;[void]$list.Columns.Add('状态',75);[void]$list.Columns.Add('文件（上方可筛选路径）',650);Row $list 5
$msg=New-Object Windows.Forms.TextBox;Row $msg 7
$buttons=New-Object Windows.Forms.FlowLayoutPanel;Row $buttons 8
$status=New-Object Windows.Forms.TextBox;$status.ReadOnly=$true;$status.Multiline=$true;$status.ScrollBars='Vertical';Row $status 9
function Caption($text,$row){$c=New-Object Windows.Forms.Label;$c.Text=$text;$c.ForeColor=$muted;$c.TextAlign='MiddleLeft';Row $c $row;return $c}
$heading=Caption ('文件同步   /   '+(Split-Path -Leaf $PWD.Path)) 0
$heading.Font=New-Object Drawing.Font('Microsoft YaHei UI',17,[Drawing.FontStyle]::Bold);$heading.ForeColor=$accent
$null=Caption '筛选文件路径' 2
$countLabel=Caption '文件变更' 4
$null=Caption '提交说明' 6
$info.ForeColor=$muted
foreach($box in @($search,$msg,$list,$status)){$box.BackColor=$surface;$box.ForeColor=$ink;$box.BorderStyle='None'}
$list.HeaderStyle='None';$list.Columns[0].Width=100
$list.add_ClientSizeChanged({$list.Columns[1].Width=[Math]::Max(160,$list.ClientSize.Width-$list.Columns[0].Width-30)})
$status.BackColor=$bg;$status.ForeColor=$muted
function Count-Files{$countLabel.Text="文件变更   $($list.Items.Count) 项可见   ·   已选 $($chosen.Count) 项"}
$chosen=New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
function Draw-List{$list.BeginUpdate();try{$list.Items.Clear();foreach($x in $script:rows){if($x.file.IndexOf($search.Text,[StringComparison]::OrdinalIgnoreCase) -lt 0){continue};$label=switch -Regex ($x.status){'^\?\?$'{'新增';break}'U'{'冲突';break}'D'{'删除';break}'M'{'修改';break}'A'{'已暂存';break}default{$x.status}};$it=New-Object Windows.Forms.ListViewItem($label);$it.ForeColor=$ink;$it.Tag=$x.file;[void]$it.SubItems.Add($x.file);$it.Checked=$chosen.Contains($x.file);[void]$list.Items.Add($it)}}finally{$list.EndUpdate();Count-Files}}
function Reload{$data=Invoke-Sync 'list';$script:rows=@($data.changes);$chosen.Clear();Draw-List;$info.Text="本地：$($PWD.Path)   分支：$($data.branch)`r`n远程：$env:DSH_SYNC_HOST  ~/projects/$env:DSH_SYNC_PROJECT";$status.Text='勾选文件，填写提交说明，然后推送。未勾选的本地修改会保留。'}
$list.add_ItemChecked({param($sender,$e) if($e.Item.Checked){[void]$chosen.Add([string]$e.Item.Tag)}else{[void]$chosen.Remove([string]$e.Item.Tag)};Count-Files})
$search.add_TextChanged({Draw-List})
function Button($title,$callback){$b=New-Object Windows.Forms.Button;$b.Text=$title;$b.AutoSize=$true;$b.FlatStyle="Flat";$b.FlatAppearance.BorderSize=0;$b.BackColor=$surface;$b.ForeColor=$ink;$b.Padding=New-Object Windows.Forms.Padding(6,2,6,2);if($title -eq "推送到服务器"){$b.BackColor=$accent;$b.ForeColor="#201810"};$b.add_Click($callback);$buttons.Controls.Add($b)}
Button '刷新' {try{Reload}catch{$status.Text=$_.Exception.Message}}
Button '勾选筛选结果' {foreach($item in $list.Items){$item.Checked=$true}}
Button '推送到服务器' {try{
 $names=@($chosen|Sort-Object)
 if($names.Count -and !$msg.Text.Trim()){throw '请在文件列表下方填写提交说明。'}
 $preview=($names|Select-Object -First 12) -join "`r`n"
 $question="向 $env:DSH_SYNC_HOST 的 $env:DSH_SYNC_PROJECT 推送当前分支和已有提交。请确认远程 Claude 已空闲。`r`n本次新增提交含 $($names.Count) 个勾选文件的完整当前内容。`r`n$preview"
 if([Windows.Forms.MessageBox]::Show($f,$question,'确认推送','OKCancel') -ne 'OK'){return}
 $f.UseWaitCursor=$true;$result=Invoke-Sync 'push' $names $msg.Text;Reload;$status.Text=$result
}catch{$status.Text=$_.Exception.Message}finally{$f.UseWaitCursor=$false}}
Button '拉取已提交代码' {try{if([Windows.Forms.MessageBox]::Show($f,'从服务器快进更新本地当前分支？','确认拉取','OKCancel') -ne 'OK'){return};$f.UseWaitCursor=$true;$result=Invoke-Sync 'pull';Reload;$status.Text=$result}catch{$status.Text=$_.Exception.Message}finally{$f.UseWaitCursor=$false}}
Button '打开本地终端' {Start-Process powershell.exe -WorkingDirectory $PWD.Path -ArgumentList '-NoLogo','-NoExit'}
$f.add_Shown({try{Reload}catch{$status.Text=$_.Exception.Message}})
[void]$f.ShowDialog()

