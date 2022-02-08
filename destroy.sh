#!/bin/bash

set -e

echo "Destroying your infrastructure in AWS..."
cdk destroy --force