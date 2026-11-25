"use strict";

const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const baseUrl = process.env.BASE_URL || "http://localhost:3000";

async function request(path, method = "GET", body, token) {
  const headers = { Connection: "close" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = response.status === 204 ? null : await response.json();
  return { response, data };
}

async function main() {
  let page = await fetch(`${baseUrl}/`, { headers: { Connection: "close" } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Eight tasks in motion/);

  let result = await request("/api/health");
  assert.equal(result.response.status, 200);
  assert.equal(result.data.status, "ok");

  result = await request("/api/greetings", "POST", { name: "A", email: "bad", course: "Web" });
  assert.equal(result.response.status, 400);
  result = await request("/api/greetings", "POST", { name: "Alex Morgan", email: "alex@example.com", course: "Full Stack" });
  assert.equal(result.response.status, 201);

  result = await request("/api/submissions", "POST", { name: "Alex", email: "alex@example.com", age: 15 });
  assert.equal(result.response.status, 400);
  result = await request("/api/submissions", "POST", { name: "Alex", email: "alex@example.com", age: 25 });
  assert.equal(result.response.status, 201);

  result = await request("/api/items", "POST", { title: "Smoke-test item" });
  assert.equal(result.response.status, 201);
  const itemId = result.data.id;
  result = await request(`/api/items/${itemId}`, "PUT", { title: "Updated smoke-test item" });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.title, "Updated smoke-test item");
  result = await request(`/api/items/${itemId}`, "DELETE");
  assert.equal(result.response.status, 204);

  const email = `smoke-${randomUUID()}@example.com`;
  result = await request("/api/register", "POST", { name: "Smoke User", email, password: "secure-password-123" });
  assert.equal(result.response.status, 201);
  const token = result.data.token;
  result = await request("/api/profile", "GET", undefined, token);
  assert.equal(result.response.status, 200);
  assert.equal(result.data.email, email);
  result = await request("/api/login", "POST", { email, password: "incorrect-password" });
  assert.equal(result.response.status, 401);
  result = await request("/api/logout", "POST", {}, token);
  assert.equal(result.response.status, 200);
  result = await request("/api/profile", "GET", undefined, token);
  assert.equal(result.response.status, 401);

  result = await request("/api/weather?city=");
  assert.equal(result.response.status, 400);

  const firstTime = await request("/api/time");
  assert.equal(firstTime.response.status, 200);
  assert.ok(["HIT", "MISS"].includes(firstTime.response.headers.get("x-cache")));
  const secondTime = await request("/api/time");
  assert.equal(secondTime.response.status, 200);
  assert.equal(secondTime.response.headers.get("x-cache"), "HIT");
  assert.equal(secondTime.data.serverTime, firstTime.data.serverTime);

  result = await request("/api/jobs", "POST", { text: "Smoke-test background job" });
  assert.equal(result.response.status, 202);
  const jobId = result.data.id;
  await new Promise((resolve) => setTimeout(resolve, 1700));
  result = await request("/api/jobs");
  assert.equal(result.data.find((job) => job.id === jobId).status, "completed");
}

main()
  .then(() => console.log("Smoke tests passed: all eight task workflows and core API routes."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
