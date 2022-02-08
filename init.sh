#!/bin/bash

set -e

echo "Initializing the infrastructure project..."
npm install
npm install -g ts-node
npm install -g aws-cdk