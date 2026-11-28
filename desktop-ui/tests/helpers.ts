import type {Page} from '@playwright/test';

/** The current zoom readout (the Zoom options menu shows it, e.g. "125% ▾"). */
export const zoomReadout=(page:Page)=>page.locator('summary[aria-label="Zoom options"]');

/** Choose a zoom level from the Zoom options menu. */
export async function chooseZoom(page:Page,percent:number){
  await zoomReadout(page).click();
  await page.locator('.studio-zoom-options').getByRole('button',{name:percent+'%',exact:true}).click();
}

/**
 * Click a toolbar command, opening the editor menu (Edit, More, ...) that holds it
 * when it is not shown directly.
 */
export async function command(page:Page,name:string){
  const button=page.getByRole('button',{name,exact:true});
  if(!(await button.first().isVisible().catch(()=>false))){
    await page.evaluate(label=>{
      for(const menu of document.querySelectorAll<HTMLDetailsElement>('main details:not([open])')){
        const match=[...menu.querySelectorAll('button')].some(b=>(b.getAttribute('aria-label')??b.textContent??'').trim()===label);
        if(match){menu.open=true;return}
      }
    },name);
  }
  await button.first().click();
}
