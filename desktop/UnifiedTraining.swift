import AppKit
import WebKit

private struct LauncherSettings: Decodable {
    let project: String
    let node: String
}

@MainActor
private final class TrainingApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var status: NSView!
    private var statusTitle: NSTextField!
    private var statusDetail: NSTextField!
    private var retry: NSButton!
    private var server: Process?
    private var pipe: Pipe?
    private var startupTimer: Timer?
    private var log = Data()
    private var ready = false
    private var restarting = false
    private let serverURL: URL = {
        let port = ProcessInfo.processInfo.environment["TRAINING_DESKTOP_PORT"].flatMap(Int.init) ?? 4175
        let localPort = (1...65535).contains(port) ? port : 4175
        return URL(string: "http://127.0.0.1:\(localPort)/")!
    }()

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenu()
        configureWindow()
        startServer()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        startupTimer?.invalidate()
        pipe?.fileHandleForReading.readabilityHandler = nil
        if let server, server.isRunning { server.terminate() }
    }

    private func configureMenu() {
        let menu = NSMenu()
        let appItem = NSMenuItem()
        menu.addItem(appItem)
        let appMenu = NSMenu()
        let reload = NSMenuItem(title: "Reload", action: #selector(reloadPage), keyEquivalent: "r")
        reload.target = self
        appMenu.addItem(reload)
        let rebuild = NSMenuItem(title: "Rebuild and Reload", action: #selector(rebuildApp), keyEquivalent: "r")
        rebuild.keyEquivalentModifierMask = [.command, .shift]
        rebuild.target = self
        appMenu.addItem(rebuild)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Unified Training", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        for (title, action, key) in [("Cut", "cut:", "x"), ("Copy", "copy:", "c"), ("Paste", "paste:", "v"), ("Select All", "selectAll:", "a")] {
            editMenu.addItem(withTitle: title, action: NSSelectorFromString(action), keyEquivalent: key)
        }
        editItem.submenu = editMenu
        menu.addItem(editItem)
        NSApp.mainMenu = menu
    }

    private func configureWindow() {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1260, height: 840),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "Unified Training"
        window.minSize = NSSize(width: 440, height: 400)
        window.setFrameAutosaveName("Unified Training")
        window.center()

        let content = NSView()
        window.contentView = content
        webView = WKWebView()
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(webView)

        status = NSView()
        status.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(status)

        statusTitle = NSTextField(labelWithString: "")
        statusTitle.font = .systemFont(ofSize: 25, weight: .semibold)
        statusDetail = NSTextField(wrappingLabelWithString: "")
        statusDetail.textColor = .secondaryLabelColor
        statusDetail.alignment = .center
        statusDetail.isSelectable = true
        retry = NSButton(title: "Retry", target: self, action: #selector(rebuildApp))
        retry.bezelStyle = .rounded
        let stack = NSStackView(views: [statusTitle, statusDetail, retry])
        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 12
        stack.translatesAutoresizingMaskIntoConstraints = false
        status.addSubview(stack)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: content.topAnchor),
            webView.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            status.topAnchor.constraint(equalTo: content.topAnchor),
            status.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            status.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            status.trailingAnchor.constraint(equalTo: content.trailingAnchor),
            stack.centerXAnchor.constraint(equalTo: status.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: status.centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualTo: status.widthAnchor, constant: -48),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 650)
        ])
    }

    private func showStatus(_ title: String, _ detail: String, retryable: Bool = false) {
        webView.isHidden = true
        status.isHidden = false
        statusTitle.stringValue = title
        statusDetail.stringValue = detail
        retry.isHidden = !retryable
    }

    @objc private func reloadPage() { webView.reload() }

    @objc private func rebuildApp() {
        guard !restarting else { return }
        if let server, server.isRunning {
            restarting = true
            showStatus("Rebuilding Unified Training", "Restarting the local server…")
            server.terminationHandler = { [weak self] stopped in
                DispatchQueue.main.async {
                    guard let self, self.server === stopped else { return }
                    self.cleanUp()
                    self.startServer()
                }
            }
            server.terminate()
        } else {
            startServer()
        }
    }

    private func startServer() {
        showStatus("Starting Unified Training", "Building the latest local version…")
        log.removeAll(keepingCapacity: true)
        ready = false

        do {
            guard let resource = Bundle.main.url(forResource: "launcher", withExtension: "json") else {
                showStatus("Launcher settings unavailable", "Rebuild the desktop app with npm run desktop:build.", retryable: true)
                return
            }
            let settings = try JSONDecoder().decode(LauncherSettings.self, from: Data(contentsOf: resource))
            let bundleProject = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent()
            let project = [bundleProject, URL(fileURLWithPath: settings.project)].first {
                FileManager.default.fileExists(atPath: $0.appendingPathComponent("desktop/launch.mjs").path)
            }
            guard let project else {
                showStatus("Project folder unavailable", "Open the app from the Unified Training project folder or rebuild it from that folder.", retryable: true)
                return
            }
            guard FileManager.default.isExecutableFile(atPath: settings.node) else {
                showStatus("Node.js unavailable", "Run npm run desktop:build with your current Node.js installation.", retryable: true)
                return
            }

            let task = Process()
            let output = Pipe()
            task.executableURL = URL(fileURLWithPath: settings.node)
            task.arguments = ["desktop/launch.mjs"]
            task.currentDirectoryURL = project
            var environment = ProcessInfo.processInfo.environment
            environment["TRAINING_DESKTOP_PORT"] = String(serverURL.port!)
            task.environment = environment
            task.standardOutput = output
            task.standardError = output
            server = task
            pipe = output

            output.fileHandleForReading.readabilityHandler = { [weak self, weak task] handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil }
                else {
                    DispatchQueue.main.async {
                        guard let self, let task, self.server === task else { return }
                        self.receive(data)
                    }
                }
            }
            task.terminationHandler = { [weak self] stopped in
                DispatchQueue.main.async {
                    guard let self, self.server === stopped else { return }
                    let remainder = self.pipe?.fileHandleForReading.readDataToEndOfFile() ?? Data()
                    self.log.append(remainder)
                    let message = String(decoding: self.log.suffix(3600), as: UTF8.self)
                    self.cleanUp()
                    self.showStatus("Unified Training stopped", message, retryable: true)
                }
            }
            try task.run()
            startupTimer = Timer.scheduledTimer(withTimeInterval: 90, repeats: false) { [weak self] _ in
                DispatchQueue.main.async {
                    self?.showStatus("Still starting", "Retry to restart the build, or check the project’s dependencies.", retryable: true)
                }
            }
        } catch {
            cleanUp()
            showStatus("Could not start Unified Training", error.localizedDescription, retryable: true)
        }
    }

    private func receive(_ data: Data) {
        log.append(data)
        if log.count > 12000 { log.removeFirst(log.count - 12000) }
        guard !ready, log.range(of: Data("Unified Training · http://127.0.0.1:\(serverURL.port!)".utf8)) != nil else { return }
        ready = true
        startupTimer?.invalidate()
        webView.load(URLRequest(url: serverURL, cachePolicy: .reloadIgnoringLocalCacheData))
    }

    private func cleanUp() {
        startupTimer?.invalidate()
        restarting = false
        pipe?.fileHandleForReading.readabilityHandler = nil
        pipe = nil
        server = nil
    }

    private func isLocal(_ url: URL) -> Bool {
        url.scheme == serverURL.scheme && url.host == serverURL.host && url.port == serverURL.port
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let url = webView.url, isLocal(url) else { return }
        status.isHidden = true
        webView.isHidden = false
        window.makeFirstResponder(webView)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showStatus("Could not open the local app", error.localizedDescription, retryable: true)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        if isLocal(url) { decisionHandler(.allow); return }
        if ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { response in
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if isLocal(url) { webView.load(action.request) }
            else if ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        }
        return nil
    }
}

@main
private enum Main {
    @MainActor static func main() {
        let app = NSApplication.shared
        let delegate = TrainingApp()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}
