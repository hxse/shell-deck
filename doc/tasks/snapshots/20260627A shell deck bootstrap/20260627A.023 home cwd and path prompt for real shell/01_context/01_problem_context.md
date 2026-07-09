# Problem Context

Real shell tabs currently start in the shell-deck project directory because the PTY backend uses the server process cwd. The default prompt is also forced to `$ `, so users cannot see the current directory in the terminal prompt.

For normal terminal use, a new shell tab should feel like a friendly local terminal: it should start from the user home directory, show the current path in the prompt, render that prompt in green, and use a preferred local monospace font when the user has one installed.
