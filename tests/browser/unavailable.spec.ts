import { test,expect } from '@playwright/test';

// Explicit diagnostic for a configured provider whose M1 schema is not accessible yet.
// This is a failure-state proof and cannot establish successful live integration.
test('configured provider failure displays unavailable inventory without simulated success',async ({page,request}) => {
  await page.goto('/');
  await expect(page.getByText('Workspace service unavailable · Please try again later.')).toBeVisible();
  await expect(page.locator('.space-card')).toHaveCount(0);
  await expect(page.locator('#resource option')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Preview your visit',exact:true})).toBeDisabled();
  await expect(page.getByText('Preview inventory · Sample prices. Live availability is not connected.')).toHaveCount(0);
  const response = await request.get('/api/availability?start=2026-10-05T09:00:00Z&end=2026-10-05T10:00:00Z');
  expect(response.status()).toBe(503);
  expect(await response.json()).not.toHaveProperty('availability');
});
