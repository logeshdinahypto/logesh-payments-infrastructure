#!/bin/bash

set -e

echo "Bootstrapping your infrastructure in AWS..."
cdk bootstrap --require-approval=never