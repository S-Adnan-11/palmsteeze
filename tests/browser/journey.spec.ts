import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('official Google light button keeps its mark, keyboard focus, return link and safe retry while busy',async({page})=>{
  await page.goto('/login?next=%2Faccount');
  const button=page.locator('.google-button');await expect(button).toHaveAccessibleName('Continue with Google');
  const style=await button.evaluate(node=>{const s=getComputedStyle(node);const img=node.querySelector('img')!;return {font:s.fontFamily,size:s.fontSize,weight:s.fontWeight,background:s.backgroundColor,color:s.color,gap:s.gap,height:node.getBoundingClientRect().height,source:img.getAttribute('src'),logo:img.getBoundingClientRect().width,arrow:node.textContent?.includes('↗')};});
  expect(style).toMatchObject({font:'"Google Sans", sans-serif',size:'14px',weight:'500',background:'rgb(255, 255, 255)',color:'rgb(31, 31, 31)',gap:'10px',source:'/auth/google-g.png',logo:20,arrow:false});expect(style.height).toBeGreaterThanOrEqual(48);
  expect(await button.evaluate(node=>node.querySelector('img')!.getBoundingClientRect().left-node.getBoundingClientRect().left)).toBe(12);
  await expect(page.locator('input[name=next]')).toHaveValue('/account');
  await button.focus();expect(await button.evaluate(n=>getComputedStyle(n).outlineStyle)).toBe('solid');
  let calls=0;
  await page.route('**/auth/sign-in',async route=>{calls++;await new Promise(resolve=>setTimeout(resolve,1000));await route.fulfill({status:503,json:{error:'Google sign-in could not be started. Check your connection and try again.'}});});
  await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Opening Google…'})).toBeDisabled();await expect(button.locator('img')).toBeVisible();
  await expect.poll(()=>calls).toBe(1);await page.keyboard.press('Enter');expect(calls).toBe(1);
  await expect(page.locator('.signin-error')).toContainText('Check your connection');await expect(button).toBeEnabled();await button.click();await expect(page.locator('.signin-error')).toBeVisible();expect(calls).toBe(2);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
  await page.unrouteAll({behavior:'wait'});
});
