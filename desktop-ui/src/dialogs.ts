export function confirmAction(message:string):Promise<boolean>{
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='studio-confirm';
  const title=document.createElement('h2');title.textContent='Confirm action';title.id='studio-confirm-title';dialog.setAttribute('aria-labelledby',title.id);
  const body=document.createElement('p');body.textContent=message;
  const footer=document.createElement('footer');const cancel=document.createElement('button');cancel.textContent='Cancel';const ok=document.createElement('button');ok.textContent='Continue';ok.className='primary';
  footer.append(cancel,ok);dialog.append(title,body,footer);document.body.append(dialog);
  cancel.onclick=()=>dialog.close('cancel');ok.onclick=()=>dialog.close('ok');
  dialog.addEventListener('close',()=>{const result=dialog.returnValue==='ok';dialog.remove();resolve(result)},{once:true});
  dialog.showModal();cancel.focus();
 });
}
export function toast(message:string,error=false){
 let host=document.getElementById('studio-toasts');if(!host){host=document.createElement('div');host.id='studio-toasts';host.setAttribute('aria-live','polite');document.body.append(host)}
 const item=document.createElement('div');item.className='studio-toast'+(error?' error':'');item.textContent=message;
 const close=document.createElement('button');close.textContent='×';close.setAttribute('aria-label','Dismiss notification');close.onclick=()=>item.remove();item.append(close);host.append(item);setTimeout(()=>item.remove(),6500);
}
