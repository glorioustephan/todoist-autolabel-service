/**
 * Validate environment variables before starting the service
 * This is used in pre-start checks to ensure all required configuration is present
 */
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  
  console.log('✓ Environment validation passed');
  console.log('\nConfiguration loaded:');
  console.log(`  Model: ${config.anthropicModel}`);
  console.log(`  Poll interval: ${config.pollIntervalMs}ms`);
  console.log(`  Log level: ${config.logLevel}`);
  console.log(`  Max labels per task: ${config.maxLabelsPerTask}`);
  console.log(`  Database path: ${config.dbPath}`);
  console.log(`  Labels path: ${config.labelsPath}`);
  
  process.exit(0);
} catch (error) {
  console.error('✗ Environment validation failed:');
  if (error instanceof Error) {
    console.error(`  ${error.message}`);
  } else {
    console.error(`  ${String(error)}`);
  }
  console.error('\nPlease check your .env file and ensure all required variables are set.');
  console.error('See env.example for reference.');
  process.exit(1);
}

