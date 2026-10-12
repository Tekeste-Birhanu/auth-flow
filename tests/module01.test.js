const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("auth views and navigation links resolve", () => {
  const html = read("index.html");
  const views = [...html.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
  const links = [...html.matchAll(/data-view-link="([^"]+)"/g)].map((match) => match[1]);

  assert.deepEqual(views, ["signin", "signup", "verify", "recovery", "new-password"]);
  assert.ok(links.every((view) => views.includes(view)));
  assert.doesNotMatch(html, /Preview the new-password form/);
});

test("dashboard account fields retain placeholders until a verified session populates them", () => {
  const html = read("dashboard.html");
  const unavailableValues = [...html.matchAll(/<dd\b[^>]*>(.*?)<\/dd>/gs)].map((match) => match[1]);
  assert.deepEqual(unavailableValues, Array(7).fill("\u2014"));
  assert.equal((html.match(/data-account-value=/g) || []).length, 7);
  assert.match(html, /data-dashboard-app hidden/);
  assert.match(html, /data-access-status role="status"/);

  const css = read("styles/dashboard.css");
  const labelSize = Number(css.match(/\.account-list dt[^\n]*font-size:\s*([\d.]+)rem/)[1]);
  const valueSize = Number(css.match(/\.account-list dd[^\n]*font-size:\s*([\d.]+)rem/)[1]);
  assert.ok(valueSize <= labelSize, "account values should be visually secondary to labels");
});

test("module 01 navigation and password safeguards remain intact", () => {
  const html = read("index.html") + read("dashboard.html");
  const js = read("scripts/script.js");
  assert.equal((html.match(/<form\b/g) || []).length, (html.match(/<form[^>]*data-local-form/g) || []).length);
  assert.ok([...html.matchAll(/<form\b[^>]*>/g)].every((match) => /method="post"/.test(match[0])));
  assert.match(js, /event\.preventDefault\(\)/);
  assert.match(js, /clearViewPasswords\(previous\)/);
  assert.match(js, /window\.addEventListener\("popstate", restoreViewFromLocation\)/);
  assert.match(js, /showView\("verify"/);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.match(js, /supabase\.auth\.signUp\(/);
  assert.match(js, /supabase\.auth\.signInWithPassword\(/);
});

test("local stylesheet, script, and image references exist", () => {
  for (const file of ["index.html", "dashboard.html"]) {
    const html = read(file);
    for (const [, reference] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
      if (/^(?:[a-z]+:|#|\/\/)/i.test(reference)) continue;
      const localPath = reference.split(/[?#]/, 1)[0];
      assert.ok(fs.existsSync(path.join(root, localPath)), `${file} references missing ${localPath}`);
    }
  }
  assert.ok(fs.existsSync(path.join(root, "scripts/auth-helpers.mjs")));
});
