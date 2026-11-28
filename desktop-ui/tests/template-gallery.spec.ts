import {expect,test} from '@playwright/test';

test.beforeEach(async({page})=>{
  await page.setViewportSize({width:1440,height:900});
  await page.addInitScript(()=>{
    localStorage.setItem('studio-tour-seen','1');
    Object.assign(window,{__TAURI_INTERNALS__:{async invoke(command:string){
      if(command==='workspace_overview')return {current:null,recovery:false};
      return ['editable_objects','character_list','prepared_bundled_designs','personal_designs'].includes(command)?[]:null;
    }}});
  });
  await page.goto('/');
});

test('the template gallery filters by category and search, and remembers favorites',async({page})=>{
  await page.getByRole('button',{name:'Template Library'}).last().click();
  const gallery=page.getByRole('region',{name:'Built-in design collection'});
  await gallery.getByRole('button',{name:/^Monograms & frames \d+$/}).click();
  await expect(gallery.getByRole('heading',{name:'Monograms & frames'})).toBeVisible();
  await gallery.getByLabel('Search artwork').fill('pink floral crest');
  await expect(gallery.locator('.tg-card')).toHaveCount(1);
  await gallery.getByRole('button',{name:'Add to favorites: Pink Floral Crest'}).click();
  await gallery.getByRole('button',{name:'Pink Floral Crest',exact:true}).click();
  const details=page.getByRole('region',{name:'Design details: Pink Floral Crest'});
  await expect(details.getByRole('button',{name:'Digitize'})).toBeVisible();
  await details.getByRole('button',{name:'Close details'}).click();
  await gallery.getByRole('button',{name:/^Favorites \d+$/}).click();
  await gallery.getByLabel('Search artwork').fill('');
  await expect(gallery.locator('.tg-card')).toHaveCount(1);
  expect(await page.evaluate(()=>localStorage.getItem('studio-template-favorites'))).toContain('pink-floral-crest');
});

test('home shows real template thumbnails and opens a category in the library',async({page})=>{
  const strip=page.getByRole('region',{name:'Start from a template'});
  await expect(strip.locator('.studio-home-template img').first()).toBeVisible();
  await strip.getByRole('group',{name:'Template categories'}).getByRole('button',{name:'Faith',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Faith',exact:true})).toBeVisible();
});

test('the library includes the full bundled template collection',async({page})=>{
  await page.getByRole('button',{name:'Template Library'}).last().click();
  const total=Number((await page.getByRole('button',{name:/^All designs \d+$/}).innerText()).match(/\d+/)![0]);
  expect(total).toBeGreaterThan(450);
});
