import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ============ macOS "Read out loud" Services entry ==========================
// macOS is the only OS with a system-wide "act on the selected text" mechanism
// (Services / Quick Actions). We install an Automator Quick Action into
// ~/Library/Services that appears in the right-click menu of ANY app when text
// is selected; it pipes the selection to the local /api/v1/speak endpoint, which
// plays it on this device. No cloud, no Accessibility permission (macOS hands
// the service the selected text directly).
//
// Windows/Linux have no equivalent OS hook for arbitrary text selections — the
// global hotkey covers those (and macOS too).

const SERVICE_NAME = "Read out loud";
const PORT = 51730; // keep in sync with EXTENSION_API_PORT in main.ts
// Bump when the generated files change so existing installs get refreshed.
const SERVICE_VERSION = "1";

function servicesDir(): string {
  return path.join(os.homedir(), "Library", "Services");
}

function workflowDir(): string {
  return path.join(servicesDir(), `${SERVICE_NAME}.workflow`);
}

const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>${SERVICE_NAME}</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSRequiredContext</key>
			<dict>
				<key>NSServiceCategory</key>
				<string>public.text</string>
			</dict>
			<key>NSSendTypes</key>
			<array>
				<string>public.utf8-plain-text</string>
				<string>NSStringPboardType</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
`;

// Automator Quick Action: a single "Run Shell Script" action that receives the
// selection on stdin and POSTs it to the local speak endpoint.
const DOCUMENT_WFLOW = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>523</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.string</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>/usr/bin/curl -s -X POST http://127.0.0.1:${PORT}/api/v1/speak --data-binary @-</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>0</integer>
					<key>shell</key>
					<string>/bin/zsh</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>1F8A2B40-0001-4C00-9000-0000000000A1</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
					<string>Command</string>
					<string>Run</string>
					<string>Unix</string>
				</array>
				<key>OutputUUID</key>
				<string>1F8A2B40-0002-4C00-9000-0000000000A2</string>
				<key>UUID</key>
				<string>1F8A2B40-0003-4C00-9000-0000000000A3</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict/>
				<key>isViewVisible</key>
				<integer>1</integer>
			</dict>
			<key>isViewVisible</key>
			<integer>1</integer>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>serviceApplicationBundleID</key>
		<string></string>
		<key>serviceApplicationPath</key>
		<string></string>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.text</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<integer>0</integer>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
`;

// Write the Quick Action bundle into ~/Library/Services on first run (or when
// the generated content version changes). Best-effort: any failure is swallowed
// so it never blocks startup.
export function installMacService(): void {
  try {
    const dir = workflowDir();
    const contents = path.join(dir, "Contents");
    const stampPath = path.join(contents, ".outloud-version");

    if (
      fs.existsSync(stampPath) &&
      fs.readFileSync(stampPath, "utf-8").trim() === SERVICE_VERSION
    ) {
      return; // already installed at this version
    }

    fs.mkdirSync(contents, { recursive: true });
    fs.writeFileSync(path.join(contents, "Info.plist"), INFO_PLIST);
    fs.writeFileSync(path.join(contents, "document.wflow"), DOCUMENT_WFLOW);
    fs.writeFileSync(stampPath, SERVICE_VERSION);
    console.log(`[service] Installed "${SERVICE_NAME}" Quick Action at ${dir}`);
  } catch (e) {
    console.warn("[service] Could not install Read-out-loud Service:", e);
  }
}
