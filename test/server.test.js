const test = require("node:test");
const assert = require("node:assert/strict");

const server = require("../server.js");

test("hashPassword produces a salt:hash pair that verifyPassword accepts", () => {
  const stored = server.hashPassword("hunter2");
  const [salt, hash] = stored.split(":");

  assert.ok(salt && hash, "stored value has both salt and hash segments");
  assert.match(salt, /^[0-9a-f]{32}$/, "salt is 16 random bytes hex-encoded");
  assert.equal(server.verifyPassword("hunter2", stored), true);
});

test("hashPassword is deterministic when a salt is supplied", () => {
  const salt = "a".repeat(32);
  assert.equal(server.hashPassword("pw", salt), server.hashPassword("pw", salt));
});

test("verifyPassword rejects wrong passwords and malformed stored values", () => {
  const stored = server.hashPassword("correct");
  assert.equal(server.verifyPassword("wrong", stored), false);
  assert.equal(server.verifyPassword("correct", ""), false);
  assert.equal(server.verifyPassword("correct", "nosalt"), false);
  assert.equal(server.verifyPassword("correct", null), false);
});

test("normalizeEmail trims, lowercases and tolerates non-strings", () => {
  assert.equal(server.normalizeEmail("  Foo@Bar.COM "), "foo@bar.com");
  assert.equal(server.normalizeEmail(null), "");
  assert.equal(server.normalizeEmail(undefined), "");
});

test("createUserRecord normalizes fields and defaults role to client", () => {
  const record = server.createUserRecord({
    email: "  User@Example.com ",
    name: "  Jane Doe  ",
    password: "secret",
    role: "hacker"
  });

  assert.match(record.id, /^[0-9a-f-]{36}$/);
  assert.equal(record.email, "user@example.com");
  assert.equal(record.name, "Jane Doe");
  assert.equal(record.role, "client");
  assert.equal(server.verifyPassword("secret", record.passwordHash), true);
  assert.ok(!Number.isNaN(Date.parse(record.createdAt)));
});

test("createUserRecord keeps admin role and clamps long names to 80 chars", () => {
  const record = server.createUserRecord({
    email: "a@b.co",
    name: "n".repeat(200),
    password: "x",
    role: "admin"
  });

  assert.equal(record.role, "admin");
  assert.equal(record.name.length, 80);
});

test("parseCookies parses a cookie header into a decoded map", () => {
  const cookies = server.parseCookies({
    headers: { cookie: "beca_session=abc123; theme=dark; empty" }
  });

  assert.deepEqual(cookies, { beca_session: "abc123", theme: "dark" });
});

test("parseCookies decodes URI-encoded names and values", () => {
  const cookies = server.parseCookies({
    headers: { cookie: "na%20me=va%20lue" }
  });
  assert.deepEqual(cookies, { "na me": "va lue" });
});

test("parseCookies returns an empty object when no cookie header is present", () => {
  assert.deepEqual(server.parseCookies({ headers: {} }), {});
});

test("toSlug lowercases, strips accents and collapses separators", () => {
  assert.equal(server.toSlug("  Golden Hour Tee!  "), "golden-hour-tee");
  assert.equal(server.toSlug("Ștefan's Édition"), "stefan-s-edition");
  assert.equal(server.toSlug(""), "");
  assert.equal(server.toSlug(null), "");
});

test("toSlug limits the slug length to 80 characters", () => {
  assert.equal(server.toSlug("a".repeat(120)).length, 80);
});

test("safePublicUser exposes only whitelisted fields and nulls falsy input", () => {
  const user = {
    id: "1",
    email: "a@b.co",
    name: "A",
    role: "client",
    createdAt: "2024-01-01T00:00:00.000Z",
    passwordHash: "salt:hash"
  };

  assert.deepEqual(server.safePublicUser(user), {
    id: "1",
    email: "a@b.co",
    name: "A",
    role: "client",
    emailVerified: false,
    createdAt: "2024-01-01T00:00:00.000Z"
  });
  assert.equal(server.safePublicUser(null), null);
});

test("publicProduct provides safe defaults and derives slug from name", () => {
  const result = server.publicProduct({
    id: "p1",
    name: "Aura Bloom",
    category: "tee",
    status: "live",
    price: 40,
    currency: "GBP",
    stock: 5
  });

  assert.equal(result.slug, "aura-bloom");
  assert.equal(result.imageUrl, "");
  assert.deepEqual(result.sizes, []);
  assert.equal(result.studio, null);
});

test("publicProduct fills studio defaults when studio data is present", () => {
  const result = server.publicProduct({
    id: "p2",
    name: "Studio Draft",
    slug: "studio-draft",
    category: "tee",
    status: "live",
    price: 40,
    currency: "GBP",
    stock: 5,
    sizes: ["S", "M"],
    studio: {}
  });

  assert.deepEqual(result.sizes, ["S", "M"]);
  assert.deepEqual(result.studio, {
    model: "assets/models/tshirt-web.glb",
    textureUrl: "",
    shirtColor: "#ffffff"
  });
});

test("sameOriginPost allows missing origin and matching hosts, rejects mismatches", () => {
  assert.equal(server.sameOriginPost({ headers: {} }), true);
  assert.equal(
    server.sameOriginPost({ headers: { origin: "https://shop.test", host: "shop.test" } }),
    true
  );
  assert.equal(
    server.sameOriginPost({ headers: { origin: "https://evil.test", host: "shop.test" } }),
    false
  );
  assert.equal(
    server.sameOriginPost({ headers: { origin: "not a url", host: "shop.test" } }),
    false
  );
});

test("sanitizeProduct clamps numbers, validates status and splits sizes", () => {
  const product = server.sanitizeProduct({
    name: "  Test Piece  ",
    price: "-10",
    stock: "3.9",
    status: "bogus",
    currency: "gbp",
    sizes: "S, M , , L,S,M,L,XL,XXL,3XL,4XL,5XL,6XL,7XL"
  });

  assert.equal(product.name, "Test Piece");
  assert.equal(product.price, 0, "negative price clamped to 0");
  assert.equal(product.stock, 3, "stock floored to an integer");
  assert.equal(product.status, "draft", "invalid status falls back to draft");
  assert.equal(product.currency, "GBP");
  assert.deepEqual(product.sizes, ["S", "M", "L", "XL", "XXL", "3XL", "4XL", "5XL", "6XL", "7XL"], "duplicate sizes are deduplicated");
  assert.match(product.id, /^[0-9a-f-]{36}$/);
});

test("sanitizeProduct does not lose stock when the size list has duplicates", () => {
  const product = server.sanitizeProduct({
    name: "Duplicate Sizes",
    stock: "9",
    sizes: "S,M,L,S,M,L"
  });

  assert.deepEqual(product.sizes, ["S", "M", "L"]);
  assert.equal(product.stock, 9, "total stock must survive deduplication of repeated size entries");
  assert.equal(
    Object.values(product.sizeStock).reduce((sum, qty) => sum + qty, 0),
    9,
    "per-size stock must add back up to the total"
  );
});

test("parseSizesInput caps unique sizes at 12 without counting duplicates against the limit", () => {
  const { sizes } = server.parseSizesInput("A,A,A,B,C,D,E,F,G,H,I,J,K,L,M");
  assert.deepEqual(sizes, ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"]);
});

test("sanitizeProduct preserves existing id, createdAt and sizes fallback", () => {
  const existing = {
    id: "keep-me",
    createdAt: "2020-01-01T00:00:00.000Z",
    sizes: ["OS"]
  };
  const product = server.sanitizeProduct({ name: "New", status: "live" }, existing);

  assert.equal(product.id, "keep-me");
  assert.equal(product.createdAt, "2020-01-01T00:00:00.000Z");
  assert.equal(product.status, "live");
  assert.deepEqual(product.sizes, ["OS"], "keeps existing sizes when none provided");
});

test("sanitizeCheckout prefers explicit input then session fallbacks", () => {
  const session = { user: { name: "Session Name", email: "session@test.co" } };

  const explicit = server.sanitizeCheckout(
    { customerName: "  Buyer  ", email: "Buyer@Test.CO", phone: "123", address: "St 1", notes: "hi" },
    session
  );
  assert.equal(explicit.customerName, "Buyer");
  assert.equal(explicit.customerEmail, "buyer@test.co");
  assert.equal(explicit.customerPhone, "123");
  assert.equal(explicit.customerAddress, "St 1");
  assert.equal(explicit.notes, "hi");

  const fallback = server.sanitizeCheckout({}, session);
  assert.equal(fallback.customerName, "Session Name");
  assert.equal(fallback.customerEmail, "session@test.co");
});

test("canAccessFile blocks data/tmp paths and gates protected pages", () => {
  assert.equal(server.canAccessFile("data/users.json", null), false);
  assert.equal(server.canAccessFile("tmp/cache.txt", null), false);
  assert.equal(server.canAccessFile("nested\\data\\secret.json", null), false);

  assert.equal(server.canAccessFile("account.html", null), false);
  assert.equal(server.canAccessFile("account.html", { user: { role: "client" } }), true);

  assert.equal(server.canAccessFile("admin/dashboard.html", { user: { role: "client" } }), false);
  assert.equal(server.canAccessFile("admin/dashboard.html", { user: { role: "admin" } }), true);

  assert.equal(server.canAccessFile("index.html", null), true);
});

test("fileToImageDataUrl builds a data url for allowed images and rejects others", () => {
  const png = { mime: "image/png", body: Buffer.from("abc") };
  assert.equal(server.fileToImageDataUrl(png), `data:image/png;base64,${Buffer.from("abc").toString("base64")}`);

  assert.equal(server.fileToImageDataUrl({ mime: "text/plain", body: Buffer.from("x") }), "");
  assert.equal(server.fileToImageDataUrl({ mime: "image/png", body: Buffer.alloc(0) }), "");
  assert.equal(server.fileToImageDataUrl(null), "");
});

test("saveDataUrlImage returns empty string for non-matching data urls", () => {
  assert.equal(server.saveDataUrlImage(""), "");
  assert.equal(server.saveDataUrlImage("data:text/plain;base64,AAAA"), "");
  assert.equal(server.saveDataUrlImage(null), "");
});

test("parseMultipart splits fields and files from a multipart buffer", () => {
  const boundary = "----testboundary";
  const body = [
    `--${boundary}`,
    'Content-Disposition: form-data; name="title"',
    "",
    "Hello",
    `--${boundary}`,
    'Content-Disposition: form-data; name="image"; filename="pic.png"',
    "Content-Type: image/png",
    "",
    "PNGDATA",
    `--${boundary}--`,
    ""
  ].join("\r\n");

  const parsed = server.parseMultipart(Buffer.from(body), `multipart/form-data; boundary=${boundary}`);

  assert.equal(parsed.fields.title, "Hello");
  assert.equal(parsed.files.image.filename, "pic.png");
  assert.equal(parsed.files.image.mime, "image/png");
  assert.equal(parsed.files.image.body.toString("utf8"), "PNGDATA");
});

test("parseMultipart throws when the boundary is missing", () => {
  assert.throws(() => server.parseMultipart(Buffer.from(""), "multipart/form-data"), /boundary/i);
});
