import {getVersion} from '@tauri-apps/api/app';
import {invoke} from '@tauri-apps/api/core';
import {useCallback,useEffect,useRef,useState} from 'react';
import {confirmAction} from './dialogs';

type UpdateStatus = {configured:boolean; version:string|null};

export function useDesktopUpdates() {
  const [version,setVersion] = useState<string|null>(null);
  const [status,setStatus] = useState('');
  const [busy,setBusy] = useState(false);
  const working = useRef(false);

  const check = useCallback(async (manual:boolean) => {
    if (working.current) return;
    working.current = true;
    if (manual) setBusy(true);
    try {
      const next = await invoke<UpdateStatus>('check_update');
      setVersion(next.version);
      if (manual || next.version) {
        setStatus(next.version ? `Stitch Studio ${next.version} is available.`
          : next.configured ? 'You have the latest version.' : 'This build uses manual updates.');
      }
    } catch (error) {
      if (manual) setStatus(`Could not check for updates. ${String(error)}`);
    } finally {
      working.current = false;
      if (manual) setBusy(false);
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

  return {version,status,busy,check,install};
}

export function UpdateSettings({updates}:{updates:ReturnType<typeof useDesktopUpdates>}) {
  const [current,setCurrent] = useState('');
  useEffect(() => {getVersion().then(setCurrent).catch(() => {});}, []);
  return <article className="preferences" id="beta-access">
    <h2>App updates</h2>
    {current && <p>Installed version {current}</p>}
    <div className="settings-actions">
      <button disabled={updates.busy} onClick={() => void updates.check(true)}>Check for updates</button>
      {updates.version && <button className="primary" disabled={updates.busy} onClick={() => void updates.install()}>Install and restart</button>}
    </div>
    <p role="status">{updates.status}</p>
  </article>;
}
