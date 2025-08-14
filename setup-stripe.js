const { createStripeProducts } = require('./src/services/stripe');

const setupStripe = async () => {
  try {
    console.log('🔄 Setting up Stripe products for QRGen Pro...');
    const { proPriceId, businessPriceId } = await createStripeProducts();
    
    console.log('\n✅ Stripe setup complete!');
    console.log('Update your PLANS object with these price IDs:');
    console.log(`Pro Plan Price ID: ${proPriceId}`);
    console.log(`Business Plan Price ID: ${businessPriceId}`);
    
  } catch (error) {
    console.error('❌ Stripe setup failed:', error.message);
    process.exit(1);
  }
  
  process.exit(0);
};

setupStripe();