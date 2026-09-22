import AppKit
import UniformTypeIdentifiers

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let arguments = CommandLine.arguments
if arguments.count != 3 || !["status", "set"].contains(arguments[1]) {
    fail("Usage: pdf-default status|set /path/to/Folio.app")
}
let applicationURL = URL(fileURLWithPath: arguments[2]).standardizedFileURL
if Bundle(url: applicationURL)?.bundleIdentifier != "com.folio.pdf" {
    fail("Choose a packaged Folio application.")
}
if #available(macOS 12.0, *) {
    let workspace = NSWorkspace.shared
    if arguments[1] == "status" {
        print(workspace.urlForApplication(toOpen: .pdf)?.standardizedFileURL == applicationURL ? "default" : "other")
        exit(0)
    }
    workspace.setDefaultApplication(at: applicationURL, toOpen: .pdf) { error in
        if let error = error { fail(error.localizedDescription) }
        guard workspace.urlForApplication(toOpen: .pdf)?.standardizedFileURL == applicationURL else {
            fail("macOS did not change the default PDF app. Try Finder’s Get Info → Open with → Change All.")
        }
        print("default")
        exit(0)
    }
    RunLoop.main.run()
} else {
    fail("Use Finder’s Get Info → Open with → Change All on this version of macOS.")
}
