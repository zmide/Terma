param(
  [switch]$SelfCheck
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class TermaWindowsCredential
{
    private const uint CredentialTypeGeneric = 1;
    private const uint CredentialPersistSession = 1;
    private const int ErrorNotFound = 1168;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NativeCredential
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias;
        public string UserName;
    }

    public sealed class Snapshot
    {
        public uint Flags;
        public uint Type;
        public string TargetName;
        public string Comment;
        public byte[] Blob;
        public uint Persist;
        public string TargetAlias;
        public string UserName;
    }

    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);

    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredWrite(ref NativeCredential credential, uint flags);

    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CredDelete(string target, uint type, uint flags);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern void CredFree(IntPtr buffer);

    public static Snapshot Read(string target)
    {
        IntPtr pointer;
        if (!CredRead(target, CredentialTypeGeneric, 0, out pointer))
        {
            int error = Marshal.GetLastWin32Error();
            if (error == ErrorNotFound) return null;
            throw new Win32Exception(error);
        }
        try
        {
            NativeCredential value = (NativeCredential)Marshal.PtrToStructure(pointer, typeof(NativeCredential));
            byte[] blob = new byte[value.CredentialBlobSize];
            if (blob.Length > 0) Marshal.Copy(value.CredentialBlob, blob, 0, blob.Length);
            return new Snapshot {
                Flags = value.Flags,
                Type = value.Type,
                TargetName = value.TargetName,
                Comment = value.Comment,
                Blob = blob,
                Persist = value.Persist,
                TargetAlias = value.TargetAlias,
                UserName = value.UserName
            };
        }
        finally
        {
            CredFree(pointer);
        }
    }

    private static void WriteBytes(string target, string username, byte[] blob, uint persist, uint flags, string comment, string alias)
    {
        IntPtr blobPointer = IntPtr.Zero;
        try
        {
            if (blob != null && blob.Length > 0)
            {
                blobPointer = Marshal.AllocCoTaskMem(blob.Length);
                Marshal.Copy(blob, 0, blobPointer, blob.Length);
            }
            NativeCredential credential = new NativeCredential {
                Flags = flags,
                Type = CredentialTypeGeneric,
                TargetName = target,
                Comment = comment,
                CredentialBlobSize = (uint)(blob == null ? 0 : blob.Length),
                CredentialBlob = blobPointer,
                Persist = persist,
                AttributeCount = 0,
                Attributes = IntPtr.Zero,
                TargetAlias = alias,
                UserName = username
            };
            if (!CredWrite(ref credential, 0)) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        finally
        {
            if (blobPointer != IntPtr.Zero)
            {
                for (int index = 0; index < blob.Length; index++) Marshal.WriteByte(blobPointer, index, 0);
                Marshal.FreeCoTaskMem(blobPointer);
            }
        }
    }

    public static void WriteSession(string target, string username, string password)
    {
        byte[] blob = System.Text.Encoding.Unicode.GetBytes(password ?? "");
        try { WriteBytes(target, username, blob, CredentialPersistSession, 0, "Terma temporary RDP credential", null); }
        finally { Array.Clear(blob, 0, blob.Length); }
    }

    public static void Restore(Snapshot snapshot)
    {
        if (snapshot == null) return;
        WriteBytes(snapshot.TargetName, snapshot.UserName, snapshot.Blob, snapshot.Persist, snapshot.Flags, snapshot.Comment, snapshot.TargetAlias);
    }

    public static void Delete(string target)
    {
        if (CredDelete(target, CredentialTypeGeneric, 0)) return;
        int error = Marshal.GetLastWin32Error();
        if (error != ErrorNotFound) throw new Win32Exception(error);
    }
}
'@

if ($SelfCheck) {
  [Console]::Out.WriteLine("TERMA_RDP_CREDENTIAL_HELPER_OK")
  exit 0
}

$payloadText = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($payloadText)) { throw "Missing RDP launch payload" }
$payload = $payloadText | ConvertFrom-Json
$targets = @($payload.targets | ForEach-Object { [string]$_ })
$username = [string]$payload.username
$password = [string]$payload.password
$executable = [string]$payload.executable
$rdpFile = [string]$payload.rdp_file
$cleanupSeconds = [Math]::Max(1, [Math]::Min(30, [int]$payload.cleanup_seconds))

if ($targets.Count -lt 1 -or $targets.Count -gt 2) { throw "Invalid RDP credential target count" }
foreach ($target in $targets) {
  if (!$target.StartsWith("TERMSRV/", [StringComparison]::OrdinalIgnoreCase)) { throw "Invalid RDP credential target" }
}
if ([string]::IsNullOrWhiteSpace($username)) { throw "Missing RDP username" }
if ($username.IndexOf([char]0) -ge 0 -or $password.IndexOf([char]0) -ge 0) { throw "Invalid RDP credential" }
if (![IO.File]::Exists($executable) -or ![IO.File]::Exists($rdpFile)) { throw "RDP client or configuration file is missing" }

$previous = @{}
$written = [Collections.Generic.List[string]]::new()
try {
  foreach ($target in $targets) {
    $previous[$target] = [TermaWindowsCredential]::Read($target)
    [TermaWindowsCredential]::WriteSession($target, $username, $password)
    $written.Add($target)
  }
  $quotedRdpFile = '"' + $rdpFile.Replace('"', '') + '"'
  [Diagnostics.Process]::Start($executable, $quotedRdpFile) | Out-Null
  [Console]::Out.WriteLine("TERMA_RDP_CREDENTIAL_READY")
  [Console]::Out.Flush()
  Start-Sleep -Seconds $cleanupSeconds
}
finally {
  $cleanupError = $null
  for ($index = $written.Count - 1; $index -ge 0; $index--) {
    $target = $written[$index]
    try {
      [TermaWindowsCredential]::Delete($target)
      if ($null -ne $previous[$target]) { [TermaWindowsCredential]::Restore($previous[$target]) }
    }
    catch {
      if ($null -eq $cleanupError) { $cleanupError = $_ }
    }
  }
  if ($null -ne $cleanupError) { throw $cleanupError }
}
