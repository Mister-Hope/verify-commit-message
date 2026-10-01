#!/usr/bin/env node
import { verifyCommitMessage } from "./verifyCommitMessage.js";

await verifyCommitMessage({ process });
