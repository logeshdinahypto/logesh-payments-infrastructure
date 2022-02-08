import {Construct} from "@aws-cdk/core";
import {Artifact, Pipeline as CodePipeline} from "@aws-cdk/aws-codepipeline";
import {StringParameter} from "@aws-cdk/aws-ssm";
import {
    CodeBuildAction,
    CodeStarConnectionsSourceAction,
    ManualApprovalAction
} from "@aws-cdk/aws-codepipeline-actions";
import {
    EventAction, FilterGroup,
    LinuxBuildImage, Project,
    Source
} from "@aws-cdk/aws-codebuild";
import {CfnConnection} from "@aws-cdk/aws-codestarconnections";
import {Effect, PolicyStatement} from "@aws-cdk/aws-iam";
import {Topic} from "@aws-cdk/aws-sns";
import {ServiceFactory} from "./service-layer/factory/service-factory";
import {Deployment} from "./configurations/deployment";

interface CICDLayerProps {
    serviceFactory: ServiceFactory;
    deployment: Deployment;
}

export class DeploymentLayer extends Construct {
    readonly codeStarConnection: CfnConnection;
    readonly useConnectionPolicy: PolicyStatement;

    public readonly pipeline: CodePipeline;

    constructor(scope: Construct, id: string, props: CICDLayerProps) {
        super(scope, id);

        this.codeStarConnection = this.createCodeStarConnection();
        this.useConnectionPolicy = this.createConnectionPolicy();
        const serviceFactory = props.serviceFactory;
        this.pipeline = this.createPipeline(scope, serviceFactory, props.deployment);
    }

    private createCodeStarConnection() : CfnConnection {
        return new CfnConnection(this, 'GitHubConnection', {
            connectionName: "GitHubConnection",
            providerType: "GitHub"
        });
    }

    private createConnectionPolicy(): PolicyStatement {
        return new PolicyStatement( {
            actions: [ 'codestar-connections:UseConnection' ],
            effect: Effect.ALLOW,
            resources: [ this.codeStarConnection.attrConnectionArn ]
        })
    }

    // @ts-ignore
    private createPipeline(scope: Construct, serviceFactory: ServiceFactory, deployment: Deployment): CodePipeline {
        const sourceOutput = new Artifact();
        const buildOutput = new Artifact();

        const owner = StringParameter.valueForStringParameter(this, `/${deployment.deploymentParamPrefix}/code-pipeline/sources/github/user`);
        const repo = StringParameter.valueForStringParameter(this, `/${deployment.deploymentParamPrefix}/code-pipeline/sources/github/repo`);
        const branch = StringParameter.valueForStringParameter(this, `/${deployment.deploymentParamPrefix}/code-pipeline/sources/github/branch`);
        const email = StringParameter.valueForStringParameter(this, `/${deployment.deploymentParamPrefix}/code-pipeline/notifications/email/primary-email`);
        // readonly slackWorkspaceId = StringParameter.valueForStringParameter(this, `/${deployment.deploymentParamPrefix}/code-pipeline/notifications/slack/workspace-id`);
        // readonly slackChannelId = StringParameter.valueForStringParameter(this, `/${deployment.deploymentParamPrefix}/code-pipeline/notifications/slack/channel-id`);

        // Create project and grant it pull push permissions to ECR
        const project = this.createProject(serviceFactory, owner, repo, branch)

        const manualApprovalTopic = new Topic(this, 'ManualApprovalTopic', {
            displayName: 'CodePipelineManualApprovalTopic'
        })

        const codeStarConnectionSourceAction = new CodeStarConnectionsSourceAction({
            actionName: "Source",
            owner: owner,
            repo: repo,
            branch: branch,
            connectionArn: this.codeStarConnection.attrConnectionArn,
            codeBuildCloneOutput: true,
            output: sourceOutput,
        });

        const codebuildAction = new CodeBuildAction({
            actionName: 'Build',
            input: sourceOutput,
            outputs: [buildOutput],
            project: project
        });

        const manualApproval = new ManualApprovalAction({
            actionName: 'Approval',
            notificationTopic: manualApprovalTopic,
            notifyEmails: [email],
            runOrder: 1
        });

        const deployAction = serviceFactory.deployAction(scope, buildOutput)

        const pipeline = new CodePipeline(this, 'Pipeline', {
            stages: [
                {
                    stageName: 'Source',
                    actions: [codeStarConnectionSourceAction],
                },
                {
                    stageName: 'Build',
                    actions: [codebuildAction],
                },
                {
                    stageName: 'Deploy',
                    actions: [manualApproval, deployAction],
                }
            ]
        });
        pipeline.role.addToPrincipalPolicy(this.useConnectionPolicy);

        // Add slack channel notification support for pipeline
        // const slackChannel = new SlackChannelConfiguration(this, `${deployment.slackConfigId}Slack`, {
        //     slackChannelConfigurationName: `${deployment.slackConfigName}-automation`,
        //     slackWorkspaceId: slackWorkspaceId,
        //     slackChannelId: slackChannelId,
        // });
        // slackChannel.addNotificationTopic(manualApprovalTopic)
        // pipeline.notifyOnExecutionStateChange('NotifyOnExecutionStateChange', slackChannel);

        return pipeline;
    }

    private createProject(serviceFactory: ServiceFactory, owner: string, repo: string, branch: string): Project {
        const gitHubSource = Source.gitHub({
            owner: owner,
            repo: repo,
            webhook: true, // optional, default: true if `webhookFilters` were provided, false otherwise
            webhookFilters: [
                FilterGroup.inEventOf(EventAction.PUSH).andBranchIs(branch),
            ], // optional, by default all pushes and Pull Requests will trigger a build
            fetchSubmodules: true
        });

        const environmentVariables = serviceFactory.environmentVariables(this)

        const project = new Project(
            this,
            'Project',
            {
                buildSpec: serviceFactory.buildSpec(),
                source: gitHubSource,
                environment: {
                    buildImage: LinuxBuildImage.STANDARD_5_0,
                    privileged: true,
                    environmentVariables
                }
            }
        );
        project.role?.addToPrincipalPolicy(this.useConnectionPolicy)
        serviceFactory.addProjectPermissions(project)
        return project;
    }
}