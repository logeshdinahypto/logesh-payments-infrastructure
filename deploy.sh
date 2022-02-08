#!/bin/bash

set -e

echo "Deploying your infrastructure in AWS..."
cdk deploy --require-approval=never