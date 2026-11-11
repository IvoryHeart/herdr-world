import { powershellCommand } from "../bridge/ssh-windows";

/**
 * Uploads staged on a Windows SSH host: the Windows form of the POSIX scripts
 * beside them. Two fixed Windows PowerShell 5.1 scripts (the route World's
 * core named-pipe relay uses), whose only inputs are a sanitized file name
 * (base64, never quoted) and the retention in minutes:
 *
 * - the private root is `%TEMP%\herdr-world-uploads-<user SID>`, created with
 *   a protected ACL granting this user alone; an existing root must not be a
 *   reparse point and must be owned by, and grant only, this user, SYSTEM or
 *   Administrators (the Windows form of the Unix owner and 0700 check);
 * - expired `upload-*` directories are removed (never through a reparse
 *   point); the upload creates a new `upload-<random>` directory, copies
 *   stdin's raw bytes into a new file there and prints its path.
 *
 * Neither runs a program.
 */

/** cmd.exe, a common OpenSSH DefaultShell, refuses longer command lines. */
const WINDOWS_COMMAND_LIMIT = 8191;
/** A staged path as the upload script prints it: a local drive path. */
export const WINDOWS_UPLOAD_PATH =
  /^[A-Za-z]:\\(?:[^\0-\x1f"*?<>|:/\\]+\\)+herdr-world-uploads-S-[0-9-]+\\upload-[a-z0-9]+\\[A-Za-z0-9._+-]+$/;

function root(retentionMinutes: number): string[] {
  if (!Number.isSafeInteger(retentionMinutes) || retentionMinutes <= 0)
    throw new Error("invalid upload retention");
  return [
    "$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'",
    "$u=[Security.Principal.WindowsIdentity]::GetCurrent().User;$x=[Security.Principal.SecurityIdentifier]",
    "$r=[IO.Path]::Combine([IO.Path]::GetTempPath(),'herdr-world-uploads-'+$u.Value)",
    "if(![IO.Directory]::Exists($r)){$s=New-Object Security.AccessControl.DirectorySecurity;$s.SetAccessRuleProtection($true,$false);$s.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($u,'FullControl','ContainerInherit, ObjectInherit','None','Allow')));[void][IO.Directory]::CreateDirectory($r,$s)}",
    "$i=Get-Item -LiteralPath $r -Force;if(!$i.PSIsContainer -or ($i.Attributes -band 1024)){exit 1}",
    "$k=@($u.Value,'S-1-5-18','S-1-5-32-544');$a=$i.GetAccessControl();if($a.GetOwner($x).Value -notin $k){exit 1}",
    "foreach($e in $a.GetAccessRules($true,$true,$x)){if($e.AccessControlType -eq 'Allow' -and $e.IdentityReference.Value -notin $k){exit 1}}",
    `$c=(Get-Date).AddMinutes(-${retentionMinutes})`,
    "foreach($o in @(Get-ChildItem -LiteralPath $r -Force -Directory -Filter 'upload-*')){if(!($o.Attributes -band 1024) -and $o.LastWriteTime -lt $c){Remove-Item -LiteralPath $o.FullName -Recurse -Force}}",
  ];
}

function command(script: string[]): string {
  const line = powershellCommand(script.join("\n"));
  if (line.length > WINDOWS_COMMAND_LIMIT)
    throw new Error("the Windows upload command is too long");
  return line;
}

/** Sweeps this user's expired uploads on the Windows host. */
export function windowsRemoteCleanupCommand(retentionMinutes: number): string {
  return command(root(retentionMinutes));
}

/**
 * Stages stdin as `name` (already sanitized for Windows) in a new private
 * directory and prints the file's path; a failed copy removes the directory.
 */
export function windowsRemoteUploadCommand(
  name: string,
  retentionMinutes: number,
): string {
  if (!/^[A-Za-z0-9._+-]{1,120}$/.test(name))
    throw new Error("invalid upload name");
  const encoded = Buffer.from(name, "utf8").toString("base64");
  return command([
    ...root(retentionMinutes),
    `$n=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
    "$d=[IO.Path]::Combine($r,'upload-'+[IO.Path]::GetRandomFileName().Replace('.',''))",
    "if([IO.Directory]::Exists($d)){exit 1};[void][IO.Directory]::CreateDirectory($d);$p=[IO.Path]::Combine($d,$n)",
    "try{$f=[IO.File]::Open($p,'CreateNew','Write','None');try{[Console]::OpenStandardInput().CopyTo($f,65536)}finally{$f.Dispose()}}catch{Remove-Item -LiteralPath $d -Recurse -Force -ErrorAction SilentlyContinue;throw}",
    "[Console]::Out.Write($p)",
  ]);
}
