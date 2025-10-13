#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { DifyOnAwsStack } from '../lib/dify-on-aws-stack';
import { UsEast1Stack } from '../lib/us-east-1-stack';
import { EnvironmentProps } from '../lib/environment-props';

export const props: EnvironmentProps = {
  awsRegion: 'us-west-2',
  awsAccount: process.env.CDK_DEFAULT_ACCOUNT!,
  // Set Dify version
  difyImageTag: '1.9.1',
  // Set plugin-daemon version to stable release
  difyPluginDaemonImageTag: '0.3.1-local',
  // Set Aurora backup retention period in days (1-35)
  auroraBackupRetentionDays: 1,

  // uncomment the below options for less expensive configuration:
  // isRedisMultiAz: false,
  // useNatInstance: true,
  // enableAuroraScalesToZero: true,
  // useFargateSpot: true,

  // Please see EnvironmentProps in lib/environment-props.ts for all the available properties
};

const app = new cdk.App();
const envName = app.node.tryGetContext('env') ?? 'dev';

let virginia: UsEast1Stack | undefined = undefined;
if ((props.useCloudFront ?? true) && (props.domainName || props.allowedIPv4Cidrs || props.allowedIPv6Cidrs)) {
  // add a unique suffix to prevent collision with different Dify instances in the same account.
  const usEastStackName = `DifyOnAwsUsEast1Stack-${envName}${props.subDomain ? `-${props.subDomain}` : ''}`;
  virginia = new UsEast1Stack(app, usEastStackName, {
    stackName: usEastStackName,
    env: { region: 'us-east-1', account: props.awsAccount },
    crossRegionReferences: true,
    domainName: props.domainName,
    allowedIpV4AddressRanges: props.allowedIPv4Cidrs,
    allowedIpV6AddressRanges: props.allowedIPv6Cidrs,
  });
}

const stackName = `DifyOnAwsStack-${envName}`;
new DifyOnAwsStack(app, stackName, {
  stackName,
  environmentName: envName,
  env: { region: props.awsRegion, account: props.awsAccount },
  crossRegionReferences: true,
  ...props,
  cloudFrontCertificate: virginia?.certificate,
  cloudFrontWebAclArn: virginia?.webAclArn,
});
