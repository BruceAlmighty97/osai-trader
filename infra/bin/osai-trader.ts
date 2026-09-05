#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { OsaiTraderStack } from '../lib/osai-trader-stack';

const app = new cdk.App();

new OsaiTraderStack(app, 'OsaiTraderStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'us-east-1',
  },
});
