import {getVersion} from '@tauri-apps/api/app';
import {invoke} from '@tauri-apps/api/core';
import {useCallback,useEffect,useRef,useState} from 'react';
import {confirmAction} from './dialogs';

type UpdateStatus = {configured:boolean; requiresAccessKey:boolean; hasAccessKey:boolean; version:string|null; error:string|null};

export function useDesktopUpdates() {
  const [version,setVersion] = useState<string|null>(null);
  const [status,setStatus] = useState('');
  const [busy,setBusy] = useState(false);
  const [requiresAccessKey,setRequiresAccessKey] = useState(false);
  const [hasAccessKey,setHasAccessKey] = useState(false);
  const working = useRef(false);

  const check = useCallback(async (manual:boolean) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const next = await invoke<UpdateStatus>('check_update');
      setVersion(next.version);
      setRequiresAccessKey(next.requiresAccessKey);
      setHasAccessKey(next.hasAccessKey);
      if (manual || next.version) {
        setStatus(next.error ?? (next.version ? `Stitch Studio ${next.version} is available.`
          : next.requiresAccessKey && !next.hasAccessKey ? 'Enter your access key to check for updates.'
          : next.configured ? 'You have the latest version.' : 'This build uses manual updates.'));
      }
    } catch (error) {
      if (manual) setStatus(`Could not check for updates. ${String(error)}`);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void check(false), 5000);
    const periodic = window.setInterval(() => void check(false), 6 * 60 * 60 * 1000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(periodic);
    };
  }, [check]);

  async function install() {
    if (!version || working.current) return;
    if (!await confirmAction('Installing this update closes Stitch Studio. Save any open projects before you continue.')) return;
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setStatus(`Installing Stitch Studio ${version}…`);
    try {
      await invoke('install_update',{version});
    } catch (error) {
      setStatus(`Could not install the update. ${String(error)}`);
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  async function saveAccessKey(key:string) {
    if (working.current) return false;
    working.current = true;
    setBusy(true);
    try {
      await invoke('save_update_access_key',{key});
    } catch (error) {
      setStatus(String(error));
      return false;
    } finally {
      working.current = false;
      setBusy(false);
    }
    await check(true);
    return true;
  }

  return {version,status,busy,check,install,requiresAccessKey,hasAccessKey,saveAccessKey};
}

export function UpdateSettings({updates}:{updates:ReturnType<typeof useDesktopUpdates>}) {
  const [current,setCurrent] = useState('');
  const [key,setKey] = useState('');
  useEffect(() => {getVersion().then(setCurrent).catch(() => {});}, []);
  return <article className="preferences" id="beta-access">
    <h2>App updates</h2>
    {current && <p>Installed version {current}</p>}
    {updates.requiresAccessKey && <form className="settings-actions" onSubmit={async event=>{
      event.preventDefault();
      if (await updates.saveAccessKey(key)) setKey('');
    }}>
      <label>Update access key <input type="password" autoComplete="off" spellCheck={false}
        value={key} onChange={event=>setKey(event.target.value)} /></label>
      <button type="submit" disabled={updates.busy||!key.trim()}>{updates.hasAccessKey?'Replace access key':'Save access key'}</button>
    </form>}
    <div className="settings-actions">
      <button disabled={updates.busy} onClick={() => void updates.check(true)}>Check for updates</button>
      {updates.version && <button className="primary" disabled={updates.busy} onClick={() => void updates.install()}>Install and restart</button>}
    </div>
    <p role="status">{updates.status}</p>
  </article>;
}
