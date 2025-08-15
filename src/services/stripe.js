const Stripe = require('stripe');
const User = require('../models-production/User');

// Ensure dotenv is loaded
require('dotenv').config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// QRGen Pro subscription plans
const PLANS = {
  FREE: {
    name: 'Free',
    price: 0,
    maxQRCodes: 5,
    features: ['Basic QR generation', 'Limited customization'],
    stripePriceId: null // Free plan doesn't need Stripe
  },
  PRO: {
    name: 'Pro',
    price: 9,
    maxQRCodes: 100,
    features: ['Analytics & tracking', 'Custom colors', 'Priority support'],
    stripePriceId: 'price_1Rw7etFXRF5SxiRxHvCZJ744' // Created in Stripe
  },
  BUSINESS: {
    name: 'Business',
    price: 49,
    maxQRCodes: 1000, // Essentially unlimited
    features: ['Unlimited QR codes', 'Advanced analytics', 'API access', 'White-label'],
    stripePriceId: 'price_1Rw7euFXRF5SxiRxfhlQ3q1b' // Created in Stripe
  }
};

// Create Stripe products and prices (run once)
const createStripeProducts = async () => {
  try {
    console.log('🔄 Creating Stripe products for QRGen Pro...');

    // Create Pro plan
    const proProduct = await stripe.products.create({
      name: 'QRGen Pro - Pro Plan',
      description: 'Advanced QR code generation with analytics and customization'
    });

    const proPrice = await stripe.prices.create({
      product: proProduct.id,
      unit_amount: 900, // $9.00
      currency: 'usd',
      recurring: {
        interval: 'month'
      },
      nickname: 'pro-monthly'
    });

    // Create Business plan  
    const businessProduct = await stripe.products.create({
      name: 'QRGen Pro - Business Plan',
      description: 'Unlimited QR codes with advanced analytics and API access'
    });

    const businessPrice = await stripe.prices.create({
      product: businessProduct.id,
      unit_amount: 4900, // $49.00
      currency: 'usd',
      recurring: {
        interval: 'month'
      },
      nickname: 'business-monthly'
    });

    console.log('✅ Stripe products created:');
    console.log('Pro Plan Price ID:', proPrice.id);
    console.log('Business Plan Price ID:', businessPrice.id);

    return {
      proPriceId: proPrice.id,
      businessPriceId: businessPrice.id
    };

  } catch (error) {
    console.error('❌ Error creating Stripe products:', error.message);
    throw error;
  }
};

// Create checkout session for subscription
const createCheckoutSession = async (userId, priceId, successUrl, cancelUrl) => {
  try {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error('User not found');
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: user.email,
      metadata: {
        userId: userId.toString()
      },
      allow_promotion_codes: true,
    });

    return session;
  } catch (error) {
    console.error('❌ Error creating checkout session:', error.message);
    throw error;
  }
};

// Create customer portal session
const createPortalSession = async (customerId, returnUrl) => {
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return session;
  } catch (error) {
    console.error('❌ Error creating portal session:', error.message);
    throw error;
  }
};

// Handle subscription status changes from webhooks
const handleSubscriptionChange = async (subscription) => {
  try {
    const userId = subscription.metadata?.userId;
    if (!userId) {
      console.log('⚠️ No userId in subscription metadata');
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      console.log('⚠️ User not found for subscription:', userId);
      return;
    }

    // Update user's subscription status
    const isActive = subscription.status === 'active';
    const priceId = subscription.items.data[0]?.price.id;

    let newPlan = 'free';
    let newLimits = {
      maxQRCodes: 5,
      canCustomize: false,
      canTrackAnalytics: false
    };

    // Determine plan based on price ID
    if (isActive) {
      if (priceId === PLANS.PRO.stripePriceId) {
        newPlan = 'pro';
        newLimits = {
          maxQRCodes: 100,
          canCustomize: true,
          canTrackAnalytics: true
        };
      } else if (priceId === PLANS.BUSINESS.stripePriceId) {
        newPlan = 'business';
        newLimits = {
          maxQRCodes: 1000,
          canCustomize: true,
          canTrackAnalytics: true
        };
      }
    }

    // Update user
    user.plan = newPlan;
    user.limits = newLimits;
    user.stripeCustomerId = subscription.customer;
    user.stripeSubscriptionId = subscription.id;
    user.subscriptionStatus = subscription.status;

    await user.save();

    console.log(`✅ Updated user ${userId} to ${newPlan} plan`);

  } catch (error) {
    console.error('❌ Error handling subscription change:', error.message);
    throw error;
  }
};

module.exports = {
  stripe,
  PLANS,
  createStripeProducts,
  createCheckoutSession,
  createPortalSession,
  handleSubscriptionChange
};