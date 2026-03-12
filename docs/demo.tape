# DVAA (Damn Vulnerable AI Agent) Demo
# Intentionally vulnerable AI agents for security training
# Run: vhs docs/demo.tape

Output docs/dvaa-demo.gif

Set Width 1200
Set Height 700
Set FontSize 20
Set FontFamily "JetBrains Mono"
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 20
Set Framerate 30
Set PlaybackSpeed 1.0

# Hidden setup
Hide
Type "cd ~/workspace/opena2a-org/damn-vulnerable-ai-agent && clear"
Enter
Sleep 500ms
Show

# Title pause
Sleep 1s

# Step 1: Start all vulnerable agents
Type "npm start"
Enter

# Wait for ASCII art banner and agent listing
Sleep 10s

# Let users read the agent list with security levels
Sleep 4s
