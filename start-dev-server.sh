#!/bin/bash

# Local development server with auto-reload
# This script starts a server that automatically refreshes when files change

PORT=8000

echo "Starting local development server on http://localhost:$PORT"
echo "The browser will auto-reload when you save changes to files."
echo ""

# Check if live-server is installed
if ! command -v live-server &> /dev/null; then
    echo "live-server not found. Installing..."
    npm install -g live-server
    echo ""
fi

# Start the server
echo "Starting server... (Press Ctrl+C to stop)"
live-server --port=$PORT --open=/
