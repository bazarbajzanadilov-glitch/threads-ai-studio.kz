import { expect, test } from "@playwright/test";

test("owner can inspect and edit a scheduled publication", async ({ page }) => {
  await page.goto("/#/dashboard");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Следующий выход|Очередь на сегодня/);

  if ((page.viewportSize()?.width ?? 1280) <= 760) {
    await page.getByRole("navigation", { name: "Мобильная навигация" }).getByRole("button", { name: "План" }).click();
  } else {
    await page.getByRole("button", { name: "Расписание", exact: true }).click();
  }
  await expect(page.getByRole("heading", { name: "Расписание" })).toBeVisible();
  await expect(page.getByText(/публикаций$/).first()).toBeVisible();

  const postItem = (page.viewportSize()?.width ?? 1280) <= 760
    ? page.locator(".schedule-card").first()
    : page.locator(".calendar-item").first();
  await expect(postItem).toBeVisible();
  await postItem.click();
  const drawer = page.getByRole("dialog", { name: /ig-|th-/i });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText(/rev\. \d+/)).toHaveText(/rev\. \d+/);

  const edit = drawer.getByRole("button", { name: "Изменить" });
  if (await edit.isVisible()) {
    await edit.click();
    const text = drawer.getByLabel("Текст публикации");
    await text.fill(`${await text.inputValue()} Проверено.`);
    await drawer.getByRole("button", { name: "Сохранить ревизию" }).click();
    await expect(page.getByText("Изменения сохранены")).toBeVisible();
  }
});

test("owner can create a Threads text draft from the web admin", async ({ page }) => {
  await page.goto("/#/schedule");
  await page.getByRole("button", { name: "Новая публикация" }).click();
  const dialog = page.getByRole("dialog", { name: "Добавить публикацию" });
  await dialog.getByRole("button", { name: /Threads/ }).click();
  await dialog.getByLabel("Текст публикации").fill("Короткая заметка о веб-разработке в Алматы.");
  await dialog.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(page.getByText("Черновик сохранён")).toBeVisible();
  await expect(dialog).toBeHidden();
});

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps the main surfaces reachable with one tap", async ({ page }) => {
    await page.goto("/#/dashboard");
    const mobileNav = page.getByRole("navigation", { name: "Мобильная навигация" });
    await expect(mobileNav).toBeVisible();
    await mobileNav.getByRole("button", { name: "План" }).click();
    await expect(page.getByRole("heading", { name: "Расписание" })).toBeVisible();
    await expect(page.locator(".schedule-card").first()).toBeVisible();
    await mobileNav.getByRole("button", { name: "Система" }).click();
    await expect(page.getByRole("heading", { name: "Состояние системы" })).toBeVisible();
  });
});
