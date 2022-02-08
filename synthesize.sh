#!/bin/bash

set -e

echo "Synthesizing your infrastructure project..."
cdk synth --json > cdk_synth.json
