import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

const GITHUB_REPO = 'BruceAlmighty97/osai-trader';
const CONTAINER_PORT = 3100;

export class OsaiTraderStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // "sandbox" (paper) by default; switch with: cdk deploy -c ttEnv=production
    const ttEnv = this.node.tryGetContext('ttEnv') ?? 'sandbox';
    // Your IP in CIDR form to open the REST API, e.g. -c allowedIngressCidr=1.2.3.4/32
    // Left unset, nothing can reach the API (the bot still runs and has egress).
    const allowedIngressCidr = this.node.tryGetContext('allowedIngressCidr');

    // Public subnets only + task public IPs = internet egress without a NAT
    // gateway (~$32/mo saved). RDS sits in the same subnets but gets no
    // public address and only accepts traffic from the service SG.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    const repo = new ecr.Repository(this, 'Repo', {
      repositoryName: 'osai-trader',
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
    });

    const serviceSg = new ec2.SecurityGroup(this, 'ServiceSg', {
      vpc,
      description: 'osai-trader Fargate service',
      allowAllOutbound: true,
    });
    if (allowedIngressCidr) {
      serviceSg.addIngressRule(
        ec2.Peer.ipv4(allowedIngressCidr),
        ec2.Port.tcp(CONTAINER_PORT),
        'REST API access',
      );
    }

    const dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc,
      description: 'osai-trader Postgres',
      allowAllOutbound: false,
    });
    dbSg.addIngressRule(serviceSg, ec2.Port.tcp(5432), 'service to Postgres');

    const db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T4G,
        ec2.InstanceSize.MICRO,
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      publiclyAccessible: false,
      securityGroups: [dbSg],
      credentials: rds.Credentials.fromGeneratedSecret('osaitrader', {
        secretName: 'osai-trader/db',
      }),
      databaseName: 'osaitrader',
      allocatedStorage: 20,
      storageType: rds.StorageType.GP3,
      multiAz: false,
      backupRetention: cdk.Duration.days(7),
      // Trading audit trail lives here — protect against accidental deletion.
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
    });

    // Fill in real values after the first deploy:
    //   aws secretsmanager put-secret-value --secret-id osai-trader/app \
    //     --secret-string '{"TT_USERNAME":"...","TT_PASSWORD":"...","ANTHROPIC_API_KEY":"..."}'
    const appSecrets = new secretsmanager.Secret(this, 'AppSecrets', {
      secretName: 'osai-trader/app',
      description: 'tastytrade credentials + Anthropic API key',
      secretObjectValue: {
        TT_USERNAME: cdk.SecretValue.unsafePlainText('CHANGE_ME'),
        TT_PASSWORD: cdk.SecretValue.unsafePlainText('CHANGE_ME'),
        ANTHROPIC_API_KEY: cdk.SecretValue.unsafePlainText('CHANGE_ME'),
      },
    });

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'osai-trader',
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });

    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    const logGroup = new logs.LogGroup(this, 'ServiceLogs', {
      logGroupName: '/osai-trader/service',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    taskDef.addContainer('service', {
      containerName: 'service',
      image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'service' }),
      portMappings: [{ containerPort: CONTAINER_PORT }],
      environment: {
        NODE_ENV: 'production',
        PORT: String(CONTAINER_PORT),
        TT_ENV: ttEnv,
        DB_SSL: 'true',
        REDDIT_USER_AGENT: 'aws-ecs:osaitrader-social:v0.1 (by /u/BruceAlmighty97)',
        SOCIAL_SUBREDDITS: 'options,thetagang,wallstreetbets,optionswheel',
      },
      secrets: {
        DB_HOST: ecs.Secret.fromSecretsManager(db.secret!, 'host'),
        DB_PORT: ecs.Secret.fromSecretsManager(db.secret!, 'port'),
        DB_USERNAME: ecs.Secret.fromSecretsManager(db.secret!, 'username'),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(db.secret!, 'password'),
        DB_NAME: ecs.Secret.fromSecretsManager(db.secret!, 'dbname'),
        TT_USERNAME: ecs.Secret.fromSecretsManager(appSecrets, 'TT_USERNAME'),
        TT_PASSWORD: ecs.Secret.fromSecretsManager(appSecrets, 'TT_PASSWORD'),
        ANTHROPIC_API_KEY: ecs.Secret.fromSecretsManager(
          appSecrets,
          'ANTHROPIC_API_KEY',
        ),
      },
    });

    const service = new ecs.FargateService(this, 'Service', {
      cluster,
      serviceName: 'osai-trader',
      taskDefinition: taskDef,
      // 0 for the first deploy (no image in ECR yet) and for the fully-scheduled
      // model; scale up with -c desiredCount=1 or `aws ecs update-service`.
      desiredCount: Number(this.node.tryGetContext('desiredCount') ?? 1),
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [serviceSg],
      // Never run two copies of a trading bot: stop the old task before
      // starting the new one instead of surging to 2.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { rollback: true },
      enableExecuteCommand: true,
    });

    // ---- GitHub Actions deploy role (OIDC, no long-lived keys) ----
    // The account already has the (one-per-account) GitHub OIDC provider,
    // so reference it rather than creating it.
    const githubOidc = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      'GithubOidc',
      `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
    );

    const deployRole = new iam.Role(this, 'DeployRole', {
      roleName: 'osai-trader-github-deploy',
      description: 'Assumed by GitHub Actions to push images and roll the ECS service',
      assumedBy: new iam.WebIdentityPrincipal(
        githubOidc.openIdConnectProviderArn,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': `repo:${GITHUB_REPO}:*`,
          },
        },
      ),
    });
    repo.grantPullPush(deployRole);
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecr:GetAuthorizationToken'],
        resources: ['*'],
      }),
    );
    deployRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:UpdateService', 'ecs:DescribeServices'],
        resources: [service.serviceArn],
      }),
    );

    new cdk.CfnOutput(this, 'EcrRepoUri', { value: repo.repositoryUri });
    new cdk.CfnOutput(this, 'ClusterName', { value: cluster.clusterName });
    new cdk.CfnOutput(this, 'ServiceName', { value: service.serviceName });
    new cdk.CfnOutput(this, 'DeployRoleArn', { value: deployRole.roleArn });
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: db.instanceEndpoint.socketAddress,
    });
    new cdk.CfnOutput(this, 'AppSecretName', { value: appSecrets.secretName });
  }
}
