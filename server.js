"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const MAX_BODY_BYTES = 16 * 1024;
const TIME_CACHE_TTL = 15_000;
const WEATHER_WINDOW_MS = 10 * 60_000;
const WEATHER_REQUEST_LIMIT = 20;

const submissions = [];
const items = [
  { id: 1, title: "Learn the Express request lifecycle" },
  { id: 2, title: "Ship a validated API" },
];
let nextItemId = 3;
let nextSubmissionId = 1;
let nextJobId = 1;
const users = new Map();
const sessions = new Map();
const jobs = [];
const weatherRequests = new Map();
let timeCache;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.writeHead(statusCode, { "Content-Type": contentType, "Cache-Control": "no-store" });
  res.end(text);
}

function sendStaticFile(res, pathname) {
  const files = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/app.js": ["app.js", "text/javascript; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
  };
  const file = files[pathname];
  if (!file) return false;

  const filePath = path.join(PUBLIC_DIR, file[0]);
  try {
    const contents = fs.readFileSync(filePath);
    res.writeHead(200, {
      "Content-Type": file[1],
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(contents);
  } catch (error) {
    console.error(`Unable to serve ${filePath}:`, error.message);
    throw new HttpError(500, "The application file could not be loaded.");
  }
  return true;
}

async function readJson(req) {
  const chunks = [];
  let length = 0;

  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY_BYTES) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }

  if (length === 0) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (body === null || Array.isArray(body) || typeof body !== "object") {
      throw new Error("Expected an object.");
    }
    return body;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function validEmail(value) {
  return typeof value === "string" && /^\S+@\S+\.\S+$/.test(value);
}

function requireSession(req) {
  const authorization = req.headers.authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const email = sessions.get(token);
  if (!email || !users.has(email)) {
    if (token) sessions.delete(token);
    throw new HttpError(401, "Please log in to view your profile.");
  }
  return { token, user: users.get(email) };
}

function createSession(email) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, email);
  return token;
}

function checkWeatherRateLimit(ip) {
  const now = Date.now();
  const current = weatherRequests.get(ip);
  if (!current || now - current.startedAt >= WEATHER_WINDOW_MS) {
    weatherRequests.set(ip, { startedAt: now, count: 1 });
    return;
  }
  if (current.count >= WEATHER_REQUEST_LIMIT) {
    throw new HttpError(429, "Weather request limit reached. Try again in a few minutes.");
  }
  current.count += 1;
}

async function getWeather(city) {
  const geoUrl = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geoUrl.search = new URLSearchParams({ name: city, count: "1", language: "en", format: "json" });
  let geoResponse;
  try {
    geoResponse = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new HttpError(502, "The weather service could not be reached. Please try again.");
  }
  if (!geoResponse.ok) throw new HttpError(502, "The location service returned an error.");

  let geoData;
  try {
    geoData = await geoResponse.json();
  } catch {
    throw new HttpError(502, "The location service returned an invalid response.");
  }
  const place = geoData.results && geoData.results[0];
  if (!place) throw new HttpError(404, "No matching city was found.");

  const forecastUrl = new URL("https://api.open-meteo.com/v1/forecast");
  forecastUrl.search = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
    timezone: "auto",
  });
  let forecastResponse;
  try {
    forecastResponse = await fetch(forecastUrl, { signal: AbortSignal.timeout(8000) });
  } catch {
    throw new HttpError(502, "The forecast service could not be reached. Please try again.");
  }
  if (!forecastResponse.ok) throw new HttpError(502, "The forecast service returned an error.");

  let forecast;
  try {
    forecast = await forecastResponse.json();
  } catch {
    throw new HttpError(502, "The forecast service returned an invalid response.");
  }
  if (!forecast.current) throw new HttpError(502, "The forecast service returned incomplete data.");

  return {
    location: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
    timezone: forecast.timezone,
    current: forecast.current,
    units: forecast.current_units,
  };
}

async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { status: "ok", service: "Cognifyz Workbench" });
  }

  if (req.method === "POST" && pathname === "/api/greetings") {
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const course = String(body.course || "").trim();
    if (name.length < 2 || name.length > 80 || !validEmail(email) || course.length < 2 || course.length > 100) {
      throw new HttpError(400, "Enter a name, valid email, and course (2–100 characters).");
    }
    return sendJson(res, 201, { message: `Thanks, ${name}! Your ${course} registration is ready.`, name, email, course });
  }

  if (req.method === "POST" && pathname === "/api/submissions") {
    const body = await readJson(req);
    const name = String(body.name || "").trim();
    const email = String(body.email || "").trim();
    const age = Number(body.age);
    if (name.length < 2 || name.length > 80) throw new HttpError(400, "Name must be between 2 and 80 characters.");
    if (!validEmail(email)) throw new HttpError(400, "Enter a valid email address.");
    if (!Number.isInteger(age) || age < 16 || age > 100) throw new HttpError(400, "Age must be a whole number between 16 and 100.");
    const submission = { id: nextSubmissionId++, name, email, age, createdAt: new Date().toISOString() };
    submissions.push(submission);
    return sendJson(res, 201, { message: `Thanks, ${name}. Your validated submission was saved.`, submission });
  }

  if (req.method === "GET" && pathname === "/api/submissions") {
    return sendJson(res, 200, submissions);
  }

  if (pathname === "/api/items" && req.method === "GET") {
    return sendJson(res, 200, items);
  }

  if (pathname === "/api/items" && req.method === "POST") {
    const body = await readJson(req);
    const title = String(body.title || "").trim();
    if (!title || title.length > 120) throw new HttpError(400, "Item title must be between 1 and 120 characters.");
    const item = { id: nextItemId++, title, createdAt: new Date().toISOString() };
    items.push(item);
    return sendJson(res, 201, item);
  }

  const itemMatch = pathname.match(/^\/api\/items\/(\d+)$/);
  if (itemMatch && req.method === "PUT") {
    const item = items.find((entry) => entry.id === Number(itemMatch[1]));
    if (!item) throw new HttpError(404, "Item not found.");
    const body = await readJson(req);
    const title = String(body.title || "").trim();
    if (!title || title.length > 120) throw new HttpError(400, "Item title must be between 1 and 120 characters.");
    item.title = title;
    return sendJson(res, 200, item);
  }

  if (itemMatch && req.method === "DELETE") {
    const index = items.findIndex((entry) => entry.id === Number(itemMatch[1]));
    if (index < 0) throw new HttpError(404, "Item not found.");
    items.splice(index, 1);
    res.writeHead(204, { "Cache-Control": "no-store" });
    return res.end();
  }

  if (req.method === "POST" && (pathname === "/api/register" || pathname === "/api/login")) {
    const body = await readJson(req);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!validEmail(email)) throw new HttpError(400, "Enter a valid email address.");
    if (password.length < 8 || password.length > 128) throw new HttpError(400, "Password must be between 8 and 128 characters.");

    if (pathname === "/api/register") {
      const name = String(body.name || "").trim();
      if (name.length < 2 || name.length > 80) throw new HttpError(400, "Name must be between 2 and 80 characters.");
      if (users.has(email)) throw new HttpError(409, "An account with that email already exists.");
      const salt = crypto.randomBytes(16);
      const hash = await scrypt(password, salt, 64);
      const user = { name, email, salt, hash };
      users.set(email, user);
      const token = createSession(email);
      return sendJson(res, 201, { token, user: { name, email } });
    }

    const user = users.get(email);
    if (!user) throw new HttpError(401, "Email or password is incorrect.");
    const hash = await scrypt(password, user.salt, 64);
    if (!crypto.timingSafeEqual(user.hash, hash)) throw new HttpError(401, "Email or password is incorrect.");
    const token = createSession(email);
    return sendJson(res, 200, { token, user: { name: user.name, email } });
  }

  if (req.method === "GET" && pathname === "/api/profile") {
    const { user } = requireSession(req);
    return sendJson(res, 200, { name: user.name, email: user.email });
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    sessions.delete(token);
    return sendJson(res, 200, { message: "You have been logged out." });
  }

  if (req.method === "GET" && pathname === "/api/weather") {
    checkWeatherRateLimit(req.socket.remoteAddress || "unknown");
    const city = String(url.searchParams.get("city") || "").trim();
    if (city.length < 2 || city.length > 80) throw new HttpError(400, "Enter a city name between 2 and 80 characters.");
    return sendJson(res, 200, await getWeather(city));
  }

  if (req.method === "GET" && pathname === "/api/time") {
    const now = Date.now();
    if (timeCache && now < timeCache.expiresAt) {
      return sendJson(res, 200, { serverTime: timeCache.serverTime, cache: "hit", expiresAt: timeCache.expiresAt }, { "X-Cache": "HIT" });
    }
    timeCache = { serverTime: new Date(now).toISOString(), expiresAt: now + TIME_CACHE_TTL };
    return sendJson(res, 200, { ...timeCache, cache: "miss" }, { "X-Cache": "MISS" });
  }

  if (req.method === "GET" && pathname === "/api/jobs") {
    return sendJson(res, 200, jobs.slice().reverse());
  }

  if (req.method === "POST" && pathname === "/api/jobs") {
    const body = await readJson(req);
    const text = String(body.text || "").trim();
    if (!text || text.length > 200) throw new HttpError(400, "Job text must be between 1 and 200 characters.");
    if (jobs.length >= 50) {
      const completedIndex = jobs.findIndex((job) => job.status === "completed");
      if (completedIndex < 0) throw new HttpError(429, "The job queue is full. Wait for a job to finish and try again.");
      jobs.splice(completedIndex, 1);
    }
    const job = { id: nextJobId++, text, status: "queued", createdAt: new Date().toISOString() };
    jobs.push(job);
    setTimeout(() => {
      job.status = "completed";
      job.completedAt = new Date().toISOString();
      console.log(`Background job ${job.id} completed.`);
    }, 1500);
    return sendJson(res, 202, job);
  }

  throw new HttpError(404, "API route not found.");
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.on("finish", () => console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - startedAt}ms`));

  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "GET" && url.pathname === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "GET" && sendStaticFile(res, url.pathname)) return;
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    sendText(res, 404, "Not found.");
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    if (statusCode >= 500) console.error("Request failed:", error);
    if (!res.headersSent) {
      sendJson(res, statusCode, { error: statusCode === 500 ? "The server could not complete the request." : error.message });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`Cognifyz Workbench is ready at http://localhost:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
