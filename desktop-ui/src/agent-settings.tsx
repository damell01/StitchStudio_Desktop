import {useEffect,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';

const localModelOff='studio-disable-local-model';

export function localModelEnabled() {
  return localStorage.getItem(localModelOff)!=='1';
}

export function AgentSettings() {
  const [enabled,setEnabled]=useState(localModelEnabled);
  const [ready,setReady]=useState<boolean|null>(null);
  const [endpoint,setEndpoint]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [client,setClient]=useState<'codex'|'claude'>('codex');

  useEffect(()=>{
    void invoke<boolean>('bundled_assistant_ready').then(setReady).catch(()=>setReady(false));
    void invoke<string|null>('agent_bridge_endpoint').then(setEndpoint).catch(()=>{});
  },[]);
  const command=endpoint&&(client==='codex'
    ? 'codex mcp add stitch-studio --url '+endpoint
    : 'claude mcp add --transport http --scope local stitch-studio '+endpoint);

  async function changeConnection() {
    if(busy)return;
    setBusy(true);setMessage('');
    try {
      if(endpoint){
        await invoke('stop_agent_bridge');setEndpoint(null);setMessage('Agent connection stopped.');
      } else {
        setEndpoint(await invoke<string>('start_agent_bridge'));
      }
    } catch(error){setMessage(String(error));} finally{setBusy(false);}
  }

  return <article className="preferences" id="assistant-settings">
    <h2>Design assistant</h2>
    <label className="settings-option"><span><strong>Use bundled local model</strong>
      <small>Interpret unfamiliar requests on this computer.</small></span>
      <input type="checkbox" checked={enabled} onChange={event=>{
        const value=event.target.checked;
        setEnabled(value);
        localStorage.setItem(localModelOff,value?'0':'1');
      }}/>
    </label>
    {ready!==null&&<p>{ready?'Bundled model ready.':'The built-in editor commands are available in this build. The optional model files are missing.'}</p>}
    <h3>Connect your own coding agent</h3>
    <p>Share the active design summary and review proposed changes from a local MCP client.</p>
    <button disabled={busy} onClick={()=>void changeConnection()}>{endpoint?'Stop agent connection':'Start agent connection'}</button>
    {command&&<div className="settings-actions">
      <label>Agent<select value={client} onChange={event=>setClient(event.target.value as 'codex'|'claude')}>
        <option value="codex">Codex CLI</option>
        <option value="claude">Claude Code</option>
      </select></label>
      <label>Setup command<input readOnly value={command} onFocus={event=>event.currentTarget.select()}/></label>
      <button onClick={()=>void navigator.clipboard.writeText(command).then(()=>setMessage('Setup command copied.')).catch(()=>setMessage('Select the command and copy it from the field.'))}>Copy setup command</button>
    </div>}
    {endpoint&&<small>Run the setup command on this computer, then open the Studio assistant to review incoming edits. Keep the connection address private.</small>}
    {message&&<p role="status">{message}</p>}
  </article>;
}
