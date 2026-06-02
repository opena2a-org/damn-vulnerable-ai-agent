# DVAA RAGBot-AIM A/B demo — same agent code, AIM denies the outbound exfil.
# Run from a host fleet first:  dvaa --api   (the demo does not work against a
# docker fleet — the agent's outbound 127.0.0.1 exfil hits the container loopback,
# not the host canary). Render:  vhs docs/aim-ab.tape
Output docs/aim-ab-demo.gif

Set Width 1080
Set Height 860
Set FontSize 18
Set FontFamily "JetBrains Mono"
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
Set Padding 24
Set Framerate 30
Set PlaybackSpeed 1.0

# Hidden setup: alias dvaa to the local binary so the visible command is authentic.
Hide
Type "cd ~/workspace/opena2a-org/damn-vulnerable-ai-agent && alias dvaa='node src/index.js' && clear"
Enter
Sleep 500ms
Show

Sleep 900ms
Type "dvaa demo aim-ab"
Sleep 600ms
Enter
Sleep 3s

# Hold on the verdict so viewers can read the A/B contrast.
Sleep 4s
