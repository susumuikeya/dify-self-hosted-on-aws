import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { CfnReplicationGroup, CfnSubnetGroup } from 'aws-cdk-lib/aws-elasticache';
import { SecurityGroup } from 'aws-cdk-lib/aws-ec2';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

export interface RedisProps {
  vpc: ec2.IVpc;
  multiAz: boolean;
  resourceNamePrefix: string;
}

export class Redis extends Construct implements ec2.IConnectable {
  readonly endpoint: string;
  public connections: ec2.Connections;
  public readonly secret: Secret;
  public readonly port: number = 6379;
  public readonly brokerUrl: StringParameter;

  constructor(scope: Construct, id: string, props: RedisProps) {
    super(scope, id);

    const { vpc, multiAz } = props;
    const subnetGroupName = `${props.resourceNamePrefix}-redis-subnets`.slice(0, 255).replace(/-+$/g, '');
    const replicationGroupId = `${props.resourceNamePrefix}-redis`.slice(0, 40).replace(/-+$/g, '');
    const secretName = `${props.resourceNamePrefix}/redis/auth`;

    const subnetGroup = new CfnSubnetGroup(this, 'SubnetGroup', {
      subnetIds: vpc.privateSubnets.concat(vpc.isolatedSubnets).map(({ subnetId }) => subnetId),
      description: 'Dify ElastiCache subnets',
      cacheSubnetGroupName: subnetGroupName,
    });

    const securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      vpc,
    });

    const secret = new Secret(this, 'AuthToken', {
      secretName,
      generateSecretString: {
        passwordLength: 30,
        excludePunctuation: true,
      },
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const redis = new CfnReplicationGroup(this, 'Resource', {
      engine: 'Valkey',
      cacheNodeType: 'cache.t4g.small',
      engineVersion: '8.0',
      cacheParameterGroupName: 'default.valkey8',
      port: this.port,
      replicasPerNodeGroup: multiAz ? 1 : 0,
      numNodeGroups: 1,
      replicationGroupDescription: 'Dify cache/queue cluster',
      cacheSubnetGroupName: subnetGroup.ref,
      automaticFailoverEnabled: multiAz,
      multiAzEnabled: multiAz,
      securityGroupIds: [securityGroup.securityGroupId],
      transitEncryptionEnabled: true,
      atRestEncryptionEnabled: true,
      authToken: secret.secretValue.unsafeUnwrap(),
      replicationGroupId,
    });

    this.endpoint = redis.attrPrimaryEndPointAddress;

    this.brokerUrl = new StringParameter(this, 'BrokerUrl', {
      // Celery crashes when ssl_cert_reqs is not set
      stringValue: `rediss://:${secret.secretValue.unsafeUnwrap()}@${this.endpoint}:${this.port}/1?ssl_cert_reqs=optional`,
      parameterName: `/dify/${props.resourceNamePrefix}/redis/broker-url`.replace(/\/{2,}/g, '/'),
    });
    this.brokerUrl.applyRemovalPolicy(RemovalPolicy.DESTROY);

    this.connections = new ec2.Connections({ securityGroups: [securityGroup], defaultPort: ec2.Port.tcp(this.port) });
    this.secret = secret;
  }
}
