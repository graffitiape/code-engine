type PathKind = "posix" | "drive" | "unc";

interface ParsedAbsolutePath {
  kind: PathKind;
  drive: string | null;
  segments: string[];
  normalized: string;
}
function parseAbsolutePath(input: string): ParsedAbsolutePath | null {
  if (!input || input.includes("\0")) return null;
  const path = input.replace(/\\/g, "/");

  let kind: PathKind;
  let drive: string | null = null;
  let rawSegments: string[];
  let protectedSegments = 0;

  const driveMatch = /^([a-zA-Z]):(?:\/(.*))?$/.exec(path);
  if (driveMatch) {
    kind = "drive";
    drive = `${driveMatch[1].toUpperCase()}:`;
    rawSegments = (driveMatch[2] ?? "").split("/");
  } else if (path.startsWith("//")) {
    kind = "unc";
    rawSegments = path.slice(2).split("/");
    protectedSegments = 2;
  } else if (path.startsWith("/")) {
    kind = "posix";
    rawSegments = path.slice(1).split("/");
  } else {
    return null;
  }

  const segments: string[] = [];
  for (const segment of rawSegments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length <= protectedSegments) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (kind === "unc" && segments.length < 2) return null;
  const normalized = kind === "posix"
    ? `/${segments.join("/")}`
    : kind === "drive"
      ? `${drive}/${segments.join("/")}`
      : `//${segments.join("/")}`;

  return { kind, drive, segments, normalized };
}

function comparableSegment(path: ParsedAbsolutePath, segment: string): string {
  return path.kind === "posix" ? segment : segment.toLocaleLowerCase("en-US");
}

function pathIsWithin(root: ParsedAbsolutePath, candidate: ParsedAbsolutePath): boolean {
  if (root.kind !== candidate.kind) return false;
  if (root.kind === "drive" && root.drive !== candidate.drive) return false;
  if (root.segments.length > candidate.segments.length) return false;
  return root.segments.every(
    (segment, index) =>
      comparableSegment(root, segment) === comparableSegment(candidate, candidate.segments[index]),
  );
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function parsedPathToFileUri(path: ParsedAbsolutePath): string | null {
  if (path.kind === "posix") {
    return `file:///${path.segments.map(encodePathSegment).join("/")}`;
  }
  if (path.kind === "drive") {
    const suffix = path.segments.map(encodePathSegment).join("/");
    return `file:///${path.drive}${suffix ? `/${suffix}` : "/"}`;
  }

  const [host, share, ...rest] = path.segments;
  if (!/^[a-zA-Z0-9.-]+$/.test(host)) return null;
  const encodedPath = [share, ...rest].map(encodePathSegment).join("/");
  return `file://${host}/${encodedPath}`;
}

function decodedFileUriPath(uri: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return null;
  }
  if (
    parsed.protocol !== "file:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return null;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\0")) return null;

  const host = parsed.hostname;
  if (host && host.toLowerCase() !== "localhost") {
    return `//${host}${pathname}`;
  }
  if (/^\/[a-zA-Z]:\//.test(pathname)) return pathname.slice(1);
  return pathname;
}

function formatLikeRoot(path: ParsedAbsolutePath, rootInput: string): string {
  if (!rootInput.includes("\\")) return path.normalized;
  return path.normalized.replace(/\//g, "\\");
}

export function normalizeWorkspacePath(path: string): string | null {
  return parseAbsolutePath(path)?.normalized ?? null;
}

export function sameWorkspacePath(left: string, right: string): boolean {
  const leftPath = parseAbsolutePath(left);
  const rightPath = parseAbsolutePath(right);
  if (!leftPath || !rightPath || leftPath.kind !== rightPath.kind) return false;
  return pathIsWithin(leftPath, rightPath) && pathIsWithin(rightPath, leftPath);
}

/** Convert an absolute workspace path to a file URI after lexical containment checks. */
export function workspacePathToFileUri(root: string, path: string): string | null {
  const parsedRoot = parseAbsolutePath(root);
  const parsedPath = parseAbsolutePath(path);
  if (!parsedRoot || !parsedPath || !pathIsWithin(parsedRoot, parsedPath)) return null;
  return parsedPathToFileUri(parsedPath);
}

/** Convert a file URI to a path only when it remains inside the supplied workspace. */
export function fileUriToWorkspacePath(root: string, uri: string): string | null {
  const parsedRoot = parseAbsolutePath(root);
  const decoded = decodedFileUriPath(uri);
  const parsedPath = decoded && parseAbsolutePath(decoded);
  if (!parsedRoot || !parsedPath || !pathIsWithin(parsedRoot, parsedPath)) return null;
  return formatLikeRoot(parsedPath, root);
}
