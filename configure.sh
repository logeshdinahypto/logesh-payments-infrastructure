#!/bin/bash

set -e

touch service.config
source service.config

POSITIONAL=()
while [[ $# -gt 0 ]]; do
  key="$1"

  case $key in
    -u|--user)
      GITHUB_USER="$2"
      shift # past argument
      shift # past value
      ;;
    -r|--repo)
      GITHUB_REPO="$2"
      shift # past argument
      shift # past value
      ;;
    -b|--branch)
      GITHUB_BRANCH="$2"
      shift # past argument
      shift # past value
      ;;
    -e|--email)
      PRIMARY_EMAIL_ADDRESS="$2"
      shift # past argument
      shift # past value
      ;;
    -p|--password)
      DB_ROOT_PASSWORD="$2"
      shift # past argument
      shift # past value
      ;;
    -t|--github-token)
      GITHUB_TOKEN="$2"
      shift # past argument
      shift # past value
      ;;
    *)    # unknown option
      POSITIONAL+=("$1") # save it in an array for later
      shift # past argument
      ;;
  esac
done

set -- "${POSITIONAL[@]}" # restore positional parameters

addOrUpdateParameter() {
    echo "Adding paremeter \"$1\" as \"$3\"..."
    aws ssm put-parameter \
        --name $1 \
        --description "$2" \
        --type String \
        --overwrite \
        --value $3
}

createSecretIfNotExists() {
    echo "Checking if secret \"$1\" already exists..."
    count=$(aws secretsmanager list-secrets | jq --arg name $1 -c '[.SecretList[] | select(.Name == $name)] | length')

    if [ "$count" -lt 1  ]
    then
        echo "Secret does not exist..."
        echo "Creating secret \"$1\" to be used in the infra..."
        aws secretsmanager create-secret \
            --name $1 \
            --description "$2" \
            --secret-string $3
    else
        echo "Secret already exists. Not creating a new replica..."
    fi
}

importSecretToCodeBuild() {
    credentialsArn=$(aws codebuild import-source-credentials --server-type GITHUB --auth-type PERSONAL_ACCESS_TOKEN --token $1 | jq --raw-output .arn)
    echo "$credentialsArn"
}

echo "Importing GitHub oAuth token into CodeBuild..."
credentialsArn=$(importSecretToCodeBuild "$GITHUB_TOKEN")

echo "Adding parameters to AWS SSM..."
addOrUpdateParameter /logesh-payments/code-build/github/access-token/arn "ARN of the GitHub access token imported to CodeBuild" "$credentialsArn"

addOrUpdateParameter /logesh-payments/code-pipeline/notifications/email/primary-email "Email address for primary recipient of Pipeline notifications" "$PRIMARY_EMAIL_ADDRESS"

addOrUpdateParameter /logesh-payments/code-pipeline/sources/github/user "Github user to be used for building the code in the pipeline" "$GITHUB_USER"

addOrUpdateParameter /logesh-payments/code-pipeline/sources/github/repo "Github repository name that contains the build sources for the pipeline" "$GITHUB_REPO"

addOrUpdateParameter /logesh-payments/code-pipeline/sources/github/branch "Github branch name that contains the build sources for the pipeline" "$GITHUB_BRANCH"

#addOrUpdateParameter /logesh-payments/code-pipeline/notifications/slack/workspace-id "Slack workspace ID to receive Pipeline state change notifications" "$SLACK_WORKSPACE_ID"

#addOrUpdateParameter /logesh-payments/code-pipeline/notifications/slack/channel-id "Slack channel ID to receive Pipeline state change notifications" "$SLACK_CHANNEL_ID"

createSecretIfNotExists /logesh-payments/database/cluster/root/password "Root password for the RDS cluster" "$DB_ROOT_PASSWORD"
