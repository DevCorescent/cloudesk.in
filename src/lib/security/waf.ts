// The web application firewall's rules: given what a request looks like (its
// address, method, path, query and a few headers) and the platform's policy,
// decide whether it passes. Pure and synchronous, so it can run on every
// request before anything else; the runtime around it is in
// src/server/security/firewall.ts. Bodies are not inspected here (they're
// validated by each route); the rules look at what scanners and injection
// attempts put in URLs and headers.
import { ipInList } from "./ip";

export type RuleGroup = "sqli" | "xss" | "traversal" | "probes" | "scanners" | "protocol" | "injection";

export type CustomRule = { id: string; name: string; enabled: boolean; action: "block" | "allow" | "log"; field: "path" | "query" | "ua" | "ip" | "country" | "method" | "host" | "referer"; op: "contains" | "equals" | "starts" | "regex" | "in"; value: string };

export type Policy = {
  mode: "off" | "monitor" | "block";
  rules: Record<RuleGroup, boolean>;
  allowIps: string[];
  blockIps: string[];
  blockCountries: string[];
  custom: CustomRule[];
};

export type Probe = {
  ip: string | null;
  country: string | null;
  method: string;
  host: string;
  /** The path as received (still percent-encoded). */
  path: string;
  /** The query string without "?" (still percent-encoded). */
  query: string;
  ua: string;
  referer: string;
  /** Other header values worth checking for injection (cookie names aren't needed). */
  headers: string[];
};

export type Verdict =
  | { action: "pass" }
  | { action: "allow"; rule: string }
  | { action: "block" | "log"; rule: string; group: RuleGroup | "ip" | "country" | "custom"; detail: string };

/** Percent-decodes up to three times (double/triple encoding is a common evasion), tolerating bad sequences. */
export function decode(s: string): string {
  let cur = s;
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(cur.replace(/\+/g, " "));
    } catch {
      next = cur.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    }
    if (next === cur) break;
    cur = next;
  }
  // SQL comments are a classic way to split keywords: "UN/**/ION".
  return cur.replace(/\/\*.*?\*\//g, " ");
}

type Sig = { id: string; re: RegExp; where: ("path" | "query" | "headers" | "ua")[] };

const SIGS: Record<RuleGroup, Sig[]> = {
  sqli: [
    { id: "sqli-union", re: /\bunion\b[\s(]+(all\s+)?select\b/i, where: ["query", "path"] },
    { id: "sqli-tautology", re: /['"`)]\s*(or|and)\s+['"`(]?\s*\w+['"`)]?\s*(=|like|<|>)\s*['"`(]?\s*\w+/i, where: ["query"] },
    { id: "sqli-stacked", re: /;\s*(drop|delete|truncate|alter|insert|update|create|exec|shutdown)\s+(table|from|into|database|\w+\s+set)\b/i, where: ["query", "path"] },
    { id: "sqli-timing", re: /\b(pg_sleep|sleep|benchmark|waitfor\s+delay)\s*\(/i, where: ["query", "path"] },
    { id: "sqli-schema", re: /\b(information_schema|pg_catalog|sysobjects|xp_cmdshell|load_file|into\s+outfile)\b/i, where: ["query", "path"] },
    { id: "sqli-comment", re: /['"`]\s*(--|#)\s*$/m, where: ["query"] },
  ],
  xss: [
    { id: "xss-script", re: /<\s*\/?\s*script\b/i, where: ["query", "path", "headers"] },
    { id: "xss-handler", re: /<[^>]*\son[a-z]{3,20}\s*=/i, where: ["query", "path"] },
    { id: "xss-js-uri", re: /(javascript|vbscript)\s*:\s*(\/\/|[a-z_$][\w$.]*\s*\(|['"`]|void\b)/i, where: ["query", "path"] },
    { id: "xss-tags", re: /<\s*(iframe|svg|object|embed|img|body|math|base|meta)\b[^>]*(on\w+|src|href|data)\s*=/i, where: ["query", "path"] },
    { id: "xss-data-uri", re: /data\s*:\s*text\/html/i, where: ["query"] },
  ],
  traversal: [
    { id: "traversal-dots", re: /(^|[/\\])\.\.([/\\]|$)/, where: ["path", "query"] },
    { id: "traversal-files", re: /(\/etc\/(passwd|shadow|hosts)|\/proc\/self\/|win\.ini|boot\.ini|\\windows\\system32)/i, where: ["path", "query"] },
    { id: "traversal-null", re: /\u0000/, where: ["path", "query"] },
  ],
  probes: [
    { id: "probe-secrets", re: /(^|\/)\.(git|svn|hg|aws|ssh|idea|vscode)(\/|$)/i, where: ["path"] },
    { id: "probe-secrets", re: /(^|\/)(\.env(\.\w+)?|id_rsa|\.htpasswd|\.htaccess|\.DS_Store|\.npmrc|\.bash_history|docker-compose\.ya?ml|composer\.(json|lock)|web\.config)$/i, where: ["path"] },
    { id: "probe-cms", re: /(^|\/)(wp-admin|wp-login\.php|wp-content|wp-includes|xmlrpc\.php|wordpress|phpmyadmin|pma|adminer(\.php)?|cgi-bin|server-status|server-info|vendor\/phpunit|actuator|jmx-console|HNAP1|boaform|solr\/admin|_ignition|telescope)(\/|$)/i, where: ["path"] },
    { id: "probe-scripts", re: /\.(php\d?|phtml|asp|aspx|jsp|cgi|pl|sh|bak|old|sql|swp)$/i, where: ["path"] },
    { id: "probe-dumps", re: /(^|\/)(backup|dump|database|db|site)\.(zip|tar|tgz|gz|rar|7z|sql)$/i, where: ["path"] },
  ],
  scanners: [
    { id: "scanner-ua", re: /\b(sqlmap|nikto|nmap|masscan|zgrab|wpscan|acunetix|nessus|openvas|dirbuster|gobuster|feroxbuster|ffuf|nuclei|hydra|w3af|havij|fimap|jaeles|zmeu|morfeus|netsparker|appscan|arachni|skipfish|whatweb|commix|xsstrike|dirsearch|wfuzz)\b/i, where: ["ua"] },
  ],
  protocol: [],
  injection: [
    { id: "inj-log4shell", re: /\$\{\s*(jndi|lower|upper|env|sys|::-)[^}]*\}?/i, where: ["query", "path", "headers"] },
    { id: "inj-shellshock", re: /\(\s*\)\s*\{\s*[:;]/, where: ["headers", "query"] },
    { id: "inj-command", re: /(;|\|\||&&|\|)\s*(cat|wget|curl|bash|sh|nc|ncat|python\d?|perl|rm|chmod|powershell)\b[^&]*(\/|\s-)/i, where: ["query"] },
    { id: "inj-subshell", re: /\$\(\s*(cat|wget|curl|id|whoami|uname|sleep)\b|`\s*(cat|wget|curl|id|whoami|uname)\b/i, where: ["query", "headers"] },
    { id: "inj-ssti", re: /(\{\{|\{%|\$\{)\s*[\w.]*(__class__|__globals__|__import__|constructor\.constructor|7\s*\*\s*7|request\.application)/i, where: ["query"] },
    { id: "inj-metadata", re: /\b(169\.254\.169\.254|metadata\.google\.internal|100\.100\.100\.200|fd00:ec2::254)\b/i, where: ["query"] },
    { id: "inj-crlf", re: /[\r\n]\s*(set-cookie|location|content-type)\s*:/i, where: ["query", "path"] },
  ],
};

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function protocolProblem(p: Probe): string | null {
  if (!METHODS.has(p.method)) return `method ${p.method.slice(0, 20)}`;
  if (p.path.length + p.query.length > 8192) return "URL too long";
  if ((p.query.match(/&/g)?.length ?? 0) > 300) return "too many query parameters";
  if (/[\u0000-\u001f\u007f]/.test(p.host) || !/^[a-z0-9.\-:[\]]*$/i.test(p.host)) return "bad Host header";
  if (p.ua.length > 2048 || p.referer.length > 4096) return "oversized header";
  return null;
}

function fieldOf(p: Probe, f: CustomRule["field"], decoded: { path: string; query: string }) {
  switch (f) {
    case "path": return decoded.path;
    case "query": return decoded.query;
    case "ua": return p.ua;
    case "ip": return p.ip ?? "";
    case "country": return p.country ?? "";
    case "method": return p.method;
    case "host": return p.host;
    case "referer": return p.referer;
  }
}

const regexCache = new Map<string, RegExp | null>();
function safeRegex(src: string): RegExp | null {
  if (!regexCache.has(src)) {
    let re: RegExp | null = null;
    try {
      // Only reasonably simple patterns (nested quantifiers are refused: they can take exponential time).
      if (src.length <= 300 && !/\([^)]*[+*][^)]*\)[+*{]/.test(src)) re = new RegExp(src, "i");
    } catch {}
    if (regexCache.size > 500) regexCache.clear();
    regexCache.set(src, re);
  }
  return regexCache.get(src)!;
}

export function customMatches(r: CustomRule, p: Probe, decoded: { path: string; query: string }): boolean {
  const v = fieldOf(p, r.field, decoded);
  const want = r.value;
  switch (r.op) {
    case "contains": return v.toLowerCase().includes(want.toLowerCase());
    case "equals": return v.toLowerCase() === want.toLowerCase();
    case "starts": return v.toLowerCase().startsWith(want.toLowerCase());
    case "regex": return !!safeRegex(want)?.test(v);
    case "in": {
      const items = want.split(/[\s,]+/).filter(Boolean);
      return r.field === "ip" ? ipInList(p.ip, items) : items.some((x) => x.toLowerCase() === v.toLowerCase());
    }
  }
}

/** The firewall's decision for one request. */
export function inspect(p: Probe, policy: Policy): Verdict {
  if (policy.mode === "off") return { action: "pass" };
  const hit = (group: Exclude<Verdict, { action: "pass" } | { action: "allow" }>["group"], rule: string, detail: string): Verdict => ({ action: policy.mode === "monitor" ? "log" : "block", rule, group, detail: detail.slice(0, 200) });
  if (ipInList(p.ip, policy.allowIps)) return { action: "allow", rule: "allow-list" };
  if (ipInList(p.ip, policy.blockIps)) return hit("ip", "ip-block", p.ip ?? "");
  if (p.country && policy.blockCountries.includes(p.country.toUpperCase())) return hit("country", "country-block", p.country);
  const decoded = { path: decode(p.path), query: decode(p.query) };
  for (const r of policy.custom) {
    if (!r.enabled || !customMatches(r, p, decoded)) continue;
    if (r.action === "allow") return { action: "allow", rule: `custom:${r.id}` };
    if (r.action === "block") return hit("custom", `custom:${r.id}`, r.name);
    return { action: "log", rule: `custom:${r.id}`, group: "custom", detail: r.name };
  }
  if (policy.rules.protocol) {
    const why = protocolProblem(p);
    if (why) return hit("protocol", "protocol", why);
  }
  const fields = { path: decoded.path, query: decoded.query, headers: [p.ua, p.referer, ...p.headers].join("\n"), ua: p.ua };
  for (const group of Object.keys(SIGS) as RuleGroup[]) {
    if (!policy.rules[group]) continue;
    for (const s of SIGS[group]) {
      for (const w of s.where) {
        const v = fields[w];
        if (!v) continue;
        const m = s.re.exec(v);
        if (m) return hit(group, s.id, `${w}: ${m[0]}`);
      }
    }
  }
  return { action: "pass" };
}

export const RULE_GROUPS: { id: RuleGroup; name: string; line: string }[] = [
  { id: "sqli", name: "SQL injection", line: "UNION SELECT, tautologies, stacked queries, timing functions, schema probes" },
  { id: "xss", name: "Cross-site scripting", line: "Script tags, event handlers, javascript: links and HTML injection in URLs" },
  { id: "traversal", name: "Path traversal", line: "../ sequences, system files and null bytes" },
  { id: "probes", name: "Scanner probes", line: ".env, .git, WordPress, phpMyAdmin, backups and script files that don't exist here" },
  { id: "scanners", name: "Attack tools", line: "sqlmap, Nikto, Nuclei, WPScan and other scanners by their user agent" },
  { id: "protocol", name: "Protocol abuse", line: "Unusual methods, oversized URLs and headers, malformed Host headers" },
  { id: "injection", name: "Code & command injection", line: "Log4Shell, Shellshock, shell commands, template injection, cloud metadata, header splitting" },
];
