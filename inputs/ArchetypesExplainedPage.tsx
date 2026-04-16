import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Stethoscope,
  Scissors,
  Briefcase,
  Wrench,
  Dumbbell,
  GraduationCap,
  Compass,
  Building2,
  Ticket,
  Camera,
  Tent,
  Package,
  MapPin,
  Waves,
  Microscope,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ArrowLeft,
  Users,
  Clock,
  Calendar,
  CreditCard,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
  Layers,
  Zap,
  MessageSquare,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// =============================================================================
// ARCHETYPE DETAILED DATA
// =============================================================================

interface ArchetypeDetail {
  id: string;
  name: string;
  icon: React.ElementType;
  categoryGroup: string;
  tagline: string;
  description: string;
  idealFor: string[];
  userFlow: {
    step: number;
    title: string;
    description: string;
  }[];
  keyFeatures: string[];
  dataRequirements: {
    required: string[];
    optional: string[];
  };
  uiComponents: string[];
  scalingConsiderations: string[];
  businessLogic: string[];
  integrations: string[];
}

const archetypeDetails: ArchetypeDetail[] = [
  // 1:1 SERVICES
  {
    id: "healthcare",
    name: "Healthcare Appointment",
    icon: Stethoscope,
    categoryGroup: "1:1 Services",
    tagline: "Provider-first appointment scheduling for medical practices",
    description:
      "A structured booking flow optimized for healthcare settings where patients select a provider, appointment type, then available slots. Emphasizes provider credentials, appointment duration, and HIPAA-compliant data handling patterns.",
    idealFor: [
      "Primary care practices",
      "Dental offices",
      "Mental health therapists",
      "Physical therapy clinics",
      "Specialist physicians",
      "Veterinary clinics",
      "Optometry offices",
    ],
    userFlow: [
      { step: 1, title: "Select Provider", description: "Choose from available healthcare providers with their specialty and credentials displayed" },
      { step: 2, title: "Choose Appointment Type", description: "Select visit type (new patient, follow-up, annual physical) with duration estimates" },
      { step: 3, title: "Pick Date", description: "Calendar selection filtered by provider availability" },
      { step: 4, title: "Select Time Slot", description: "Grid of available time slots for the selected date" },
      { step: 5, title: "Confirm Booking", description: "Review and confirm appointment details" },
    ],
    keyFeatures: [
      "Provider cards with credentials and specialty",
      "Appointment type selector with duration",
      "Date picker with availability filtering",
      "Time slot grid",
      "Insurance information capture",
      "New patient vs. existing patient flows",
    ],
    dataRequirements: {
      required: ["providers", "appointment_types", "availability_calendar", "patient_info"],
      optional: ["insurance_plans", "intake_forms", "referral_codes", "telehealth_options"],
    },
    uiComponents: ["ProviderCard", "AppointmentTypeSelector", "Calendar", "TimeSlotGrid", "PatientInfoForm"],
    scalingConsiderations: [
      "Add provider bio/credentials page",
      "Implement patient portal with history",
      "Add telehealth vs. in-person toggle",
      "Insurance verification integration",
      "Waitlist functionality for full schedules",
      "Recurring appointment booking",
    ],
    businessLogic: [
      "Buffer time between appointments",
      "Provider-specific availability rules",
      "Appointment type duration variations",
      "New patient longer slot allocation",
      "Cancellation/reschedule policies",
    ],
    integrations: ["EHR systems", "Insurance verification APIs", "SMS/Email reminders", "Telehealth platforms"],
  },
  {
    id: "beauty",
    name: "Beauty & Personal Care",
    icon: Scissors,
    categoryGroup: "1:1 Services",
    tagline: "Multi-service booking with staff preferences for salons and spas",
    description:
      "A flexible booking system allowing clients to select multiple services, optionally choose a preferred stylist, and see combined pricing and duration. Perfect for businesses where services can be stacked and staff specialization matters.",
    idealFor: [
      "Hair salons",
      "Nail salons",
      "Day spas",
      "Barbershops",
      "Med spas",
      "Tattoo studios",
      "Massage therapy",
      "Esthetician services",
    ],
    userFlow: [
      { step: 1, title: "Select Services", description: "Multi-select from service menu with prices and durations" },
      { step: 2, title: "View Summary", description: "See combined total time and price for selected services" },
      { step: 3, title: "Choose Stylist", description: "Optional: select preferred staff member or 'no preference'" },
      { step: 4, title: "Pick Date & Time", description: "Calendar and time slot selection based on combined duration" },
      { step: 5, title: "Confirm & Pay", description: "Review booking and optional deposit payment" },
    ],
    keyFeatures: [
      "Multi-select service cards with checkboxes",
      "Running total (price + duration) display",
      "Staff preference pills with availability status",
      "Service category grouping (Hair, Nails, Skin, etc.)",
      "Add-on services suggestions",
    ],
    dataRequirements: {
      required: ["services", "staff", "availability", "pricing"],
      optional: ["service_categories", "add_ons", "membership_discounts", "deposit_rules"],
    },
    uiComponents: ["ServiceCard", "ServiceSummary", "StaffPills", "CategoryTabs", "AddOnSelector"],
    scalingConsiderations: [
      "Service package deals",
      "Membership/subscription tiers",
      "Gift card purchases",
      "Before/after photo galleries",
      "Loyalty points system",
      "Product recommendations post-service",
    ],
    businessLogic: [
      "Service duration stacking",
      "Staff specialization filtering",
      "Peak pricing (weekend/evening)",
      "Deposit requirements for longer services",
      "No-show policies",
    ],
    integrations: ["POS systems", "Inventory management", "CRM", "Marketing automation"],
  },
  {
    id: "professional",
    name: "Professional Consultation",
    icon: Briefcase,
    categoryGroup: "1:1 Services",
    tagline: "Consultation-focused booking for knowledge workers and advisors",
    description:
      "A streamlined booking flow for professional services where consultation type determines pricing and duration. Often includes free discovery calls as lead generation and paid deeper consultations.",
    idealFor: [
      "Law firms",
      "Financial advisors",
      "Business consultants",
      "Life coaches",
      "Career counselors",
      "Real estate agents",
      "Accountants & CPAs",
    ],
    userFlow: [
      { step: 1, title: "Select Consultation Type", description: "Choose from free intro call, paid consultation, or strategy session" },
      { step: 2, title: "Pick Date", description: "Quick date picker showing next available slots" },
      { step: 3, title: "Select Time", description: "Available time slots for the selected date" },
      { step: 4, title: "Provide Details", description: "Brief intake form about consultation topic" },
      { step: 5, title: "Confirm", description: "Review and optional payment for paid consultations" },
    ],
    keyFeatures: [
      "Consultation type cards with pricing and duration",
      "Free vs. paid session distinction",
      "Quick date selection (today, tomorrow, this week)",
      "Virtual meeting link generation",
      "Brief intake questionnaire",
    ],
    dataRequirements: {
      required: ["consultation_types", "availability", "contact_info"],
      optional: ["intake_questions", "payment_info", "calendar_sync", "video_platform"],
    },
    uiComponents: ["ConsultationTypeCard", "QuickDatePicker", "TimeSlotSelector", "IntakeForm", "MeetingConfirmation"],
    scalingConsiderations: [
      "Automated follow-up sequences",
      "Document upload for preparation",
      "Recurring consultation packages",
      "Team member assignment",
      "Client portal with history",
      "Automated invoicing",
    ],
    businessLogic: [
      "Free call limit per client",
      "Consultation to client conversion tracking",
      "Time zone handling",
      "Cancellation/reschedule policies",
      "Buffer time between calls",
    ],
    integrations: ["Calendar (Google, Outlook)", "Zoom/Teams/Meet", "CRM", "Payment processors", "Contract signing"],
  },
  {
    id: "home-service",
    name: "Home & Field Service",
    icon: Wrench,
    categoryGroup: "1:1 Services",
    tagline: "Location-based service scheduling with arrival windows",
    description:
      "A practical booking system for services delivered at the customer's location. Features service type selection, flexible date picking, and arrival window preferences rather than exact times.",
    idealFor: [
      "Plumbers",
      "Electricians",
      "HVAC technicians",
      "House cleaners",
      "Landscapers",
      "Handyman services",
      "Pest control",
      "Appliance repair",
    ],
    userFlow: [
      { step: 1, title: "Select Service Type", description: "Choose repair, maintenance, installation, or emergency" },
      { step: 2, title: "Describe Issue", description: "Brief description and optional photo upload" },
      { step: 3, title: "Enter Address", description: "Service location with service area validation" },
      { step: 4, title: "Pick Date", description: "Available dates based on service area" },
      { step: 5, title: "Choose Arrival Window", description: "Morning, afternoon, or evening time window" },
    ],
    keyFeatures: [
      "Service type grid with pricing indicators",
      "Emergency service option with premium pricing",
      "Address autocomplete with service area check",
      "Arrival window selector (not exact times)",
      "Issue description with photo upload",
    ],
    dataRequirements: {
      required: ["service_types", "service_areas", "availability", "customer_address"],
      optional: ["technician_assignment", "parts_inventory", "photos", "emergency_pricing"],
    },
    uiComponents: ["ServiceTypeGrid", "AddressInput", "ServiceAreaMap", "ArrivalWindowSelector", "IssueDescriptionForm"],
    scalingConsiderations: [
      "Technician assignment and routing",
      "Parts ordering integration",
      "Quote generation before confirmation",
      "Recurring service plans (maintenance)",
      "Real-time technician tracking",
      "Invoice and payment on-site",
    ],
    businessLogic: [
      "Service area radius/zones",
      "Travel time estimation",
      "Emergency vs. standard pricing",
      "Minimum service charges",
      "Technician skill matching",
    ],
    integrations: ["Maps/routing", "Inventory systems", "Field service management", "Payment processing"],
  },
  {
    id: "multi-location",
    name: "Multi-Location Service",
    icon: MapPin,
    categoryGroup: "1:1 Services",
    tagline: "Location selector first, then standard booking flow",
    description:
      "A location-first booking pattern for businesses with multiple branches. Users select their preferred location (often by proximity), then proceed through the standard service booking flow.",
    idealFor: [
      "Dental chains",
      "Fitness franchises",
      "Retail service chains",
      "Medical groups",
      "Banking/financial branches",
      "Auto service centers",
    ],
    userFlow: [
      { step: 1, title: "Find Location", description: "Search by zip, use current location, or browse list" },
      { step: 2, title: "Select Branch", description: "Choose from nearby locations with hours and services" },
      { step: 3, title: "Choose Service", description: "Service selection (may vary by location)" },
      { step: 4, title: "Pick Date & Time", description: "Location-specific availability" },
      { step: 5, title: "Confirm", description: "Review with location details and directions" },
    ],
    keyFeatures: [
      "Location search with map view",
      "Distance/proximity sorting",
      "Location cards with hours and amenities",
      "Service availability by location",
      "Directions integration",
    ],
    dataRequirements: {
      required: ["locations", "location_services", "location_availability", "coordinates"],
      optional: ["amenities", "parking_info", "transit_info", "photos"],
    },
    uiComponents: ["LocationSearch", "LocationMap", "LocationCard", "DistanceIndicator", "DirectionsLink"],
    scalingConsiderations: [
      "Location-specific promotions",
      "Cross-location appointment transfer",
      "Favorite location saving",
      "Location comparison view",
      "Wait time estimates per location",
    ],
    businessLogic: [
      "Service radius calculation",
      "Location-specific pricing",
      "Staff sharing between locations",
      "Capacity management per location",
    ],
    integrations: ["Google Maps", "Location management systems", "Central scheduling"],
  },

  // CLASSES & EVENTS
  {
    id: "fitness-class",
    name: "Fitness & Studio Class",
    icon: Dumbbell,
    categoryGroup: "Classes & Events",
    tagline: "Day-based class schedule with spot reservation",
    description:
      "A schedule-centric booking system showing all classes for a given day with instructor, time, duration, level, and remaining spots. Users browse the schedule and reserve spots in classes.",
    idealFor: [
      "Yoga studios",
      "CrossFit boxes",
      "Spin/cycling studios",
      "Pilates studios",
      "Dance studios",
      "Martial arts schools",
      "Swimming classes",
    ],
    userFlow: [
      { step: 1, title: "Select Day", description: "Tab-based day selector (Today, Tomorrow, etc.)" },
      { step: 2, title: "Browse Classes", description: "View all classes for that day with details" },
      { step: 3, title: "Select Class", description: "Choose a class based on time, instructor, level" },
      { step: 4, title: "Confirm Spot", description: "Reserve your spot (may use class pass or payment)" },
    ],
    keyFeatures: [
      "Day tabs for quick navigation",
      "Class cards with instructor, time, level, spots",
      "Spots remaining indicator (urgency for low spots)",
      "Level badges (Beginner, Intermediate, Advanced)",
      "Instructor info link",
    ],
    dataRequirements: {
      required: ["class_schedule", "instructors", "capacity", "bookings"],
      optional: ["class_descriptions", "level_requirements", "equipment_needed", "waitlist"],
    },
    uiComponents: ["DayTabs", "ClassCard", "SpotsIndicator", "LevelBadge", "InstructorAvatar"],
    scalingConsiderations: [
      "Class package purchases",
      "Membership integration",
      "Waitlist with auto-enrollment",
      "Class series/programs",
      "Instructor substitution handling",
      "Class cancellation notifications",
    ],
    businessLogic: [
      "Capacity limits per class",
      "Late cancellation penalties",
      "No-show tracking",
      "Class pass deduction",
      "Waitlist management",
    ],
    integrations: ["Membership systems", "Class pass platforms", "Instructor scheduling"],
  },
  {
    id: "workshop",
    name: "Workshop & Course",
    icon: GraduationCap,
    categoryGroup: "Classes & Events",
    tagline: "Event-style booking with participant count and one-time dates",
    description:
      "A workshop-focused booking system for one-time or limited-run educational events. Shows upcoming workshops with dates, times, instructors, and pricing. Supports multiple participant registration.",
    idealFor: [
      "Cooking classes",
      "Art workshops",
      "Craft studios",
      "Photography classes",
      "Coding bootcamps",
      "Language schools",
      "Professional development",
    ],
    userFlow: [
      { step: 1, title: "Browse Workshops", description: "View upcoming workshops with dates and pricing" },
      { step: 2, title: "Select Workshop", description: "Choose a workshop to learn more and register" },
      { step: 3, title: "Set Participants", description: "Select number of attendees" },
      { step: 4, title: "Review & Pay", description: "See total cost and complete registration" },
    ],
    keyFeatures: [
      "Workshop cards with date, time, instructor, price",
      "Spots remaining indicator",
      "Participant quantity selector",
      "Materials/requirements list",
      "Instructor bio/credentials",
    ],
    dataRequirements: {
      required: ["workshops", "dates", "pricing", "capacity"],
      optional: ["materials_list", "prerequisites", "instructor_bio", "photos"],
    },
    uiComponents: ["WorkshopCard", "ParticipantSelector", "MaterialsList", "InstructorBio", "RegistrationSummary"],
    scalingConsiderations: [
      "Multi-session course tracking",
      "Certificates of completion",
      "Private group booking",
      "Virtual workshop options",
      "Materials kit add-ons",
      "Early bird pricing",
    ],
    businessLogic: [
      "Minimum participant requirements",
      "Group discount tiers",
      "Cancellation refund policies",
      "Materials cost inclusion",
      "Certificate generation",
    ],
    integrations: ["Learning management systems", "Video platforms", "Certificate generation"],
  },
  {
    id: "tour",
    name: "Tour & Experience",
    icon: Compass,
    categoryGroup: "Classes & Events",
    tagline: "Experience booking with party size and guest types",
    description:
      "An experience-focused booking system for tours and activities. Features tour selection, date availability, and party composition (adults, children) with appropriate pricing calculations.",
    idealFor: [
      "Walking tours",
      "Food tours",
      "Adventure activities",
      "Wine tastings",
      "Museum tours",
      "Boat trips",
      "Sightseeing tours",
    ],
    userFlow: [
      { step: 1, title: "Browse Experiences", description: "View available tours with duration, rating, price" },
      { step: 2, title: "Select Experience", description: "Choose a tour to book" },
      { step: 3, title: "Pick Date", description: "Select from available dates" },
      { step: 4, title: "Set Party Size", description: "Specify adults and children (with different pricing)" },
      { step: 5, title: "Review & Book", description: "See total price and confirm booking" },
    ],
    keyFeatures: [
      "Tour cards with duration, ratings, reviews",
      "Per-person pricing display",
      "Date availability grid",
      "Party size selector (adults/children)",
      "Child pricing (often discounted)",
    ],
    dataRequirements: {
      required: ["experiences", "dates", "pricing", "capacity"],
      optional: ["reviews", "photos", "languages", "pickup_locations"],
    },
    uiComponents: ["ExperienceCard", "RatingDisplay", "DateGrid", "PartySizeSelector", "PriceSummary"],
    scalingConsiderations: [
      "Private tour options",
      "Multi-language support",
      "Pickup/meeting point selection",
      "Weather-dependent scheduling",
      "Gift vouchers",
      "Group booking requests",
    ],
    businessLogic: [
      "Adult vs. child pricing",
      "Minimum party size requirements",
      "Maximum capacity limits",
      "Weather cancellation policies",
      "Language/guide matching",
    ],
    integrations: ["Review platforms", "Weather APIs", "Translation services", "Local guides marketplace"],
  },

  // RESOURCES & SPACES
  {
    id: "workspace",
    name: "Workspace & Meeting Room",
    icon: Building2,
    categoryGroup: "Resources & Spaces",
    tagline: "Space type and duration-based booking for coworking",
    description:
      "A space-centric booking system for coworking and meeting rooms. Users select space type, booking duration (hourly, daily, monthly), and specific time/date preferences.",
    idealFor: [
      "Coworking spaces",
      "Meeting room rentals",
      "Private office rentals",
      "Training rooms",
      "Conference centers",
      "Hot desk facilities",
    ],
    userFlow: [
      { step: 1, title: "Select Space Type", description: "Choose hot desk, private office, meeting room, etc." },
      { step: 2, title: "Choose Duration", description: "Hourly, half-day, full-day, or monthly" },
      { step: 3, title: "Pick Date/Time", description: "Select specific date and time range" },
      { step: 4, title: "View Amenities", description: "See included amenities and add-ons" },
      { step: 5, title: "Confirm & Pay", description: "Review booking and complete payment" },
    ],
    keyFeatures: [
      "Space type cards with capacity and features",
      "Duration selector (hourly rates vs. day rates)",
      "Amenities list (WiFi, whiteboard, coffee, etc.)",
      "Capacity indicator for meeting rooms",
      "Time range selector",
    ],
    dataRequirements: {
      required: ["spaces", "pricing_tiers", "availability", "capacity"],
      optional: ["amenities", "add_ons", "floor_plans", "photos"],
    },
    uiComponents: ["SpaceTypeCard", "DurationSelector", "TimeRangeSlider", "AmenityList", "FloorPlanView"],
    scalingConsiderations: [
      "Membership plans with included hours",
      "Recurring booking patterns",
      "Multi-room booking for events",
      "Visitor/guest passes",
      "Access control integration",
      "Catering add-ons",
    ],
    businessLogic: [
      "Hourly vs. daily vs. monthly rates",
      "Peak/off-peak pricing",
      "Minimum booking duration",
      "Cleaning buffer between bookings",
      "Member vs. non-member pricing",
    ],
    integrations: ["Access control systems", "Calendar sync", "Accounting/invoicing", "Visitor management"],
  },
  {
    id: "sports",
    name: "Sports Facility",
    icon: Dumbbell,
    categoryGroup: "Resources & Spaces",
    tagline: "Court and facility booking with time slots",
    description:
      "A facility booking system for sports venues. Users select the resource type (court, lane, field), date, and available time slots. Often includes equipment rental add-ons.",
    idealFor: [
      "Tennis clubs",
      "Basketball courts",
      "Swimming pools (lane booking)",
      "Golf courses (tee times)",
      "Squash courts",
      "Badminton facilities",
      "Indoor soccer fields",
    ],
    userFlow: [
      { step: 1, title: "Select Resource", description: "Choose court type, lane, or facility" },
      { step: 2, title: "Pick Date", description: "Calendar selection" },
      { step: 3, title: "Choose Time Slot", description: "View and select available slots" },
      { step: 4, title: "Add Equipment", description: "Optional equipment rental" },
      { step: 5, title: "Confirm", description: "Review and complete booking" },
    ],
    keyFeatures: [
      "Resource cards with surface type, features",
      "Time slot grid showing availability",
      "Equipment rental add-ons",
      "Member vs. guest pricing",
      "Recurring booking option",
    ],
    dataRequirements: {
      required: ["resources", "time_slots", "availability", "pricing"],
      optional: ["equipment", "membership_levels", "instructors", "leagues"],
    },
    uiComponents: ["ResourceCard", "TimeSlotGrid", "EquipmentSelector", "MembershipBadge", "BookingSummary"],
    scalingConsiderations: [
      "League/tournament scheduling",
      "Pro lesson booking",
      "Equipment maintenance tracking",
      "Guest pass management",
      "Multi-court booking for events",
      "Lighting/facility condition reporting",
    ],
    businessLogic: [
      "Peak hour pricing",
      "Member priority booking windows",
      "Cancellation policies",
      "Court maintenance schedules",
      "Equipment inventory management",
    ],
    integrations: ["Membership systems", "Court lighting automation", "Weather services"],
  },
  {
    id: "venue",
    name: "Event Venue",
    icon: Ticket,
    categoryGroup: "Resources & Spaces",
    tagline: "Venue booking with capacity and packages",
    description:
      "A venue inquiry and booking system for event spaces. Features venue browsing with capacity, package selection, and inquiry/quote request flow. Often requires consultation before final booking.",
    idealFor: [
      "Wedding venues",
      "Corporate event spaces",
      "Party venues",
      "Conference halls",
      "Banquet halls",
      "Rooftop venues",
      "Outdoor event spaces",
    ],
    userFlow: [
      { step: 1, title: "Browse Venues", description: "View venue options with capacity and style" },
      { step: 2, title: "Select Venue", description: "Choose venue to explore packages" },
      { step: 3, title: "Check Availability", description: "Enter event date to check availability" },
      { step: 4, title: "Choose Package", description: "Select from venue packages (basic, premium, all-inclusive)" },
      { step: 5, title: "Request Quote", description: "Submit inquiry with event details for custom quote" },
    ],
    keyFeatures: [
      "Venue cards with photos, capacity, style",
      "Capacity range display (min-max guests)",
      "Package comparison",
      "Photo gallery",
      "Quote request form",
    ],
    dataRequirements: {
      required: ["venues", "capacity", "packages", "availability"],
      optional: ["photos", "catering_options", "decoration_packages", "vendor_list"],
    },
    uiComponents: ["VenueCard", "CapacityRange", "PackageComparison", "PhotoGallery", "QuoteRequestForm"],
    scalingConsiderations: [
      "Virtual tour integration",
      "Vendor marketplace integration",
      "Custom package builder",
      "Floor plan visualization",
      "Review/testimonial display",
      "Site visit scheduling",
    ],
    businessLogic: [
      "Seasonal pricing",
      "Minimum spend requirements",
      "Deposit and payment schedules",
      "Vendor exclusivity rules",
      "Setup and breakdown time allocation",
    ],
    integrations: ["CRM for leads", "Virtual tour platforms", "Vendor management", "Contract/e-signature"],
  },
  {
    id: "studio",
    name: "Creative Studio",
    icon: Camera,
    categoryGroup: "Resources & Spaces",
    tagline: "Studio rental by the hour with equipment add-ons",
    description:
      "An hourly rental system for creative spaces like photo studios, recording studios, or podcast rooms. Features studio selection, time booking, and extensive equipment add-on options.",
    idealFor: [
      "Photography studios",
      "Video production studios",
      "Podcast recording rooms",
      "Music recording studios",
      "Rehearsal spaces",
      "Art studio rentals",
    ],
    userFlow: [
      { step: 1, title: "Select Studio", description: "Choose studio type based on your needs" },
      { step: 2, title: "Check Availability", description: "View calendar of available slots" },
      { step: 3, title: "Select Time Block", description: "Choose start time and duration" },
      { step: 4, title: "Add Equipment", description: "Select cameras, lights, mics, backdrops, etc." },
      { step: 5, title: "Confirm & Pay", description: "Review total with equipment and complete booking" },
    ],
    keyFeatures: [
      "Studio cards with dimensions, features",
      "Hourly rate display",
      "Equipment catalog with pricing",
      "Add-on equipment selector",
      "Minimum booking duration",
    ],
    dataRequirements: {
      required: ["studios", "hourly_rates", "availability", "equipment"],
      optional: ["studio_photos", "included_equipment", "technician_availability", "sample_work"],
    },
    uiComponents: ["StudioCard", "AvailabilityCalendar", "TimeBlockSelector", "EquipmentCatalog", "BookingSummary"],
    scalingConsiderations: [
      "Technician/assistant booking",
      "Post-production services",
      "Membership with discounted rates",
      "Equipment insurance options",
      "Storage locker rentals",
      "Portfolio hosting",
    ],
    businessLogic: [
      "Minimum booking hours",
      "Equipment damage deposits",
      "Overtime pricing",
      "Technician hourly rates",
      "Setup/teardown time inclusion",
    ],
    integrations: ["Equipment tracking", "Photo delivery platforms", "Invoicing systems"],
  },
  {
    id: "entertainment",
    name: "Entertainment Venue",
    icon: Ticket,
    categoryGroup: "Resources & Spaces",
    tagline: "Experience booking with group size and session times",
    description:
      "A session-based booking system for entertainment venues. Users select experience type, group size, and from fixed session start times. Perfect for time-slotted entertainment.",
    idealFor: [
      "Escape rooms",
      "VR arcades",
      "Karaoke rooms",
      "Bowling alleys",
      "Laser tag",
      "Axe throwing",
      "Mini golf",
    ],
    userFlow: [
      { step: 1, title: "Select Experience", description: "Choose room theme, game type, or activity" },
      { step: 2, title: "Enter Group Size", description: "Specify number of participants" },
      { step: 3, title: "Pick Date", description: "Select your preferred date" },
      { step: 4, title: "Choose Session", description: "Select from available session start times" },
      { step: 5, title: "Add Extras", description: "Optional: photos, food packages, etc." },
    ],
    keyFeatures: [
      "Experience cards with difficulty, duration, theme",
      "Group size selector with capacity limits",
      "Session time display",
      "Difficulty/theme indicators",
      "Add-on packages (party, food, photos)",
    ],
    dataRequirements: {
      required: ["experiences", "sessions", "capacity", "pricing"],
      optional: ["difficulty_levels", "themes", "add_on_packages", "photos"],
    },
    uiComponents: ["ExperienceCard", "GroupSizeSelector", "SessionTimeGrid", "DifficultyBadge", "AddOnPackages"],
    scalingConsiderations: [
      "Party package builder",
      "Corporate event booking",
      "Gift card system",
      "Leaderboard/records integration",
      "Photo package delivery",
      "Multi-experience combo booking",
    ],
    businessLogic: [
      "Per-person vs. per-group pricing",
      "Minimum/maximum group sizes",
      "Session duration fixed times",
      "Private booking premium",
      "Waiver requirements",
    ],
    integrations: ["POS for food/beverage", "Photo delivery", "Waiver management", "Marketing/CRM"],
  },
  {
    id: "lab",
    name: "Lab Booking System",
    icon: Microscope,
    categoryGroup: "Resources & Spaces",
    tagline: "Research equipment and facility reservation system",
    description:
      "A specialized booking system for research facilities. Handles equipment certification requirements, safety protocols, and complex availability rules for shared scientific resources.",
    idealFor: [
      "University research labs",
      "Shared scientific equipment facilities",
      "Clean rooms",
      "Maker spaces",
      "Fabrication labs",
      "Testing laboratories",
    ],
    userFlow: [
      { step: 1, title: "Select Resource Type", description: "Choose equipment category or facility type" },
      { step: 2, title: "Check Certification", description: "Verify user has required training/certification" },
      { step: 3, title: "Pick Date & Duration", description: "Select date and time block needed" },
      { step: 4, title: "Add Requirements", description: "Specify materials, assistance needed" },
      { step: 5, title: "Submit Request", description: "Request may require approval" },
    ],
    keyFeatures: [
      "Resource cards with specifications",
      "Certification/training requirements",
      "Supervisor approval workflow",
      "Usage time tracking",
      "Safety protocol acknowledgment",
    ],
    dataRequirements: {
      required: ["resources", "certifications", "availability", "user_credentials"],
      optional: ["maintenance_schedule", "consumables", "assistance_requests", "project_codes"],
    },
    uiComponents: ["ResourceCard", "CertificationChecker", "TimeBlockSelector", "ApprovalStatus", "SafetyAcknowledgment"],
    scalingConsiderations: [
      "Usage reporting and billing",
      "Maintenance request system",
      "Training session booking",
      "Resource utilization analytics",
      "Grant/project code tracking",
      "Waitlist with priority levels",
    ],
    businessLogic: [
      "Certification verification",
      "Approval workflows",
      "Usage quota management",
      "Priority user access",
      "Maintenance blackout periods",
    ],
    integrations: ["Equipment management systems", "Training management", "Billing/grants systems", "Safety compliance"],
  },
  {
    id: "library",
    name: "Library Seat Reservation",
    icon: BookOpen,
    categoryGroup: "Resources & Spaces",
    tagline: "Study space reservation with zone and amenity filtering",
    description:
      "A seat and space reservation system for libraries. Users select study zone type (quiet, group, computer), floor, and specific seat/desk. Includes time limits and renewal options.",
    idealFor: [
      "University libraries",
      "Public libraries",
      "Study centers",
      "Reading rooms",
      "Computer labs",
      "Group study room booking",
    ],
    userFlow: [
      { step: 1, title: "Select Zone Type", description: "Choose quiet study, group work, computer area" },
      { step: 2, title: "Pick Floor/Area", description: "Select floor and specific area" },
      { step: 3, title: "View Availability", description: "See floor map with available seats" },
      { step: 4, title: "Select Seat/Room", description: "Click on available seat or room" },
      { step: 5, title: "Confirm Time Block", description: "Set duration within time limits" },
    ],
    keyFeatures: [
      "Zone type selector (quiet, group, computer)",
      "Floor map with seat availability",
      "Amenity icons (power, window, standing desk)",
      "Time limit display",
      "Renewal/extension option",
    ],
    dataRequirements: {
      required: ["zones", "seats", "availability", "time_limits"],
      optional: ["floor_maps", "amenities", "reservation_rules", "membership_levels"],
    },
    uiComponents: ["ZoneSelector", "FloorMap", "SeatMarker", "AmenityIcons", "TimeBlockPicker"],
    scalingConsiderations: [
      "Real-time availability updates",
      "No-show detection and penalties",
      "Group room with equipment requests",
      "Integration with library card",
      "Noise level monitoring",
      "Popular time predictions",
    ],
    businessLogic: [
      "Maximum reservation duration",
      "Advance booking limits",
      "No-show policies",
      "Renewal rules",
      "Peak time restrictions",
    ],
    integrations: ["Library management systems", "Card access systems", "Room displays", "Occupancy sensors"],
  },

  // STAYS & RENTALS
  {
    id: "accommodation",
    name: "Accommodation",
    icon: Tent,
    categoryGroup: "Stays & Rentals",
    tagline: "Multi-night stay booking with room selection",
    description:
      "A stay-focused booking system for accommodations. Features date range selection, room/unit type comparison, guest count, and nightly rate calculations with potential add-ons.",
    idealFor: [
      "Hotels",
      "Vacation rentals",
      "B&Bs",
      "Glamping sites",
      "Hostels",
      "Resort properties",
      "Cabins and cottages",
    ],
    userFlow: [
      { step: 1, title: "Enter Dates", description: "Select check-in and check-out dates" },
      { step: 2, title: "Set Guests", description: "Specify adults, children, rooms needed" },
      { step: 3, title: "View Room Types", description: "Browse available room types with rates" },
      { step: 4, title: "Select Room", description: "Choose your preferred accommodation" },
      { step: 5, title: "Add Extras", description: "Optional: breakfast, late checkout, etc." },
      { step: 6, title: "Complete Booking", description: "Review total and confirm" },
    ],
    keyFeatures: [
      "Date range picker with stay duration",
      "Guest/room count selector",
      "Room type cards with photos, amenities, rates",
      "Nightly rate calculation",
      "Add-on services",
    ],
    dataRequirements: {
      required: ["room_types", "availability", "rates", "capacity"],
      optional: ["photos", "amenities", "add_ons", "policies", "reviews"],
    },
    uiComponents: ["DateRangePicker", "GuestSelector", "RoomTypeCard", "AmenityList", "RateSummary"],
    scalingConsiderations: [
      "Dynamic pricing integration",
      "OTA channel management",
      "Package deals (room + experiences)",
      "Loyalty program integration",
      "Housekeeping coordination",
      "Pre-arrival communication",
    ],
    businessLogic: [
      "Rate calculation with seasonality",
      "Minimum stay requirements",
      "Cancellation policies",
      "Deposit requirements",
      "Occupancy restrictions",
    ],
    integrations: ["PMS systems", "OTA channels", "Revenue management", "Housekeeping systems"],
  },
  {
    id: "equipment",
    name: "Equipment Rental",
    icon: Package,
    categoryGroup: "Stays & Rentals",
    tagline: "Item rental with date range and quantity selection",
    description:
      "A rental-focused booking system for equipment and items. Users browse inventory, select rental dates, specify quantities, and see daily/weekly rate calculations.",
    idealFor: [
      "Camera equipment",
      "Party supplies",
      "Sports equipment",
      "Tools and machinery",
      "AV equipment",
      "Camping gear",
      "Medical equipment",
    ],
    userFlow: [
      { step: 1, title: "Browse Items", description: "Search or browse rental inventory by category" },
      { step: 2, title: "Select Items", description: "Add items to cart with quantities" },
      { step: 3, title: "Set Rental Dates", description: "Choose pickup and return dates" },
      { step: 4, title: "Choose Options", description: "Delivery vs. pickup, insurance, etc." },
      { step: 5, title: "Review & Pay", description: "See total with deposits and confirm" },
    ],
    keyFeatures: [
      "Item catalog with daily/weekly rates",
      "Quantity selector with availability check",
      "Date range picker",
      "Insurance/protection options",
      "Deposit requirements display",
    ],
    dataRequirements: {
      required: ["items", "inventory_levels", "rates", "availability"],
      optional: ["categories", "insurance_options", "delivery_options", "accessories"],
    },
    uiComponents: ["ItemCard", "QuantitySelector", "DateRangePicker", "InsuranceOptions", "RentalSummary"],
    scalingConsiderations: [
      "Package bundles",
      "Delivery/pickup scheduling",
      "Damage waiver integration",
      "Late return penalties",
      "Inventory tracking",
      "Maintenance scheduling",
    ],
    businessLogic: [
      "Daily vs. weekly rate calculations",
      "Security deposit requirements",
      "Late fee calculations",
      "Damage assessment workflow",
      "Inventory reservation holds",
    ],
    integrations: ["Inventory management", "Delivery scheduling", "Payment processing", "Insurance providers"],
  },

  // HYBRID
  {
    id: "classes-private",
    name: "Classes + Private Sessions",
    icon: Dumbbell,
    categoryGroup: "Hybrid",
    tagline: "Toggle between group classes and 1:1 private sessions",
    description:
      "A hybrid booking system that lets users choose between group classes (schedule-based) and private sessions (provider-based). Common for yoga, music lessons, tutoring, and fitness.",
    idealFor: [
      "Yoga studios with private sessions",
      "Music teachers",
      "Personal trainers",
      "Tutoring services",
      "Language teachers",
      "Golf/tennis instruction",
    ],
    userFlow: [
      { step: 1, title: "Choose Type", description: "Toggle between Group Class or Private Session" },
      { step: 2, title: "Group: Browse Classes", description: "View class schedule, pick a class" },
      { step: 2, title: "Private: Select Instructor", description: "Choose your preferred instructor" },
      { step: 3, title: "Pick Date/Time", description: "Select from available slots" },
      { step: 4, title: "Add Details", description: "Session focus, goals, or special requests" },
      { step: 5, title: "Confirm", description: "Review and complete booking" },
    ],
    keyFeatures: [
      "Type toggle (Group/Private)",
      "Class schedule view (group)",
      "Instructor selector (private)",
      "Different pricing display",
      "Session focus/goals input",
    ],
    dataRequirements: {
      required: ["classes", "instructors", "availability_both_types", "pricing"],
      optional: ["session_types", "skill_levels", "goals_options", "package_options"],
    },
    uiComponents: ["TypeToggle", "ClassSchedule", "InstructorSelector", "PricingComparison", "SessionGoals"],
    scalingConsiderations: [
      "Package deals (X classes + Y private)",
      "Intro offer for new clients",
      "Progress tracking across sessions",
      "Instructor matching algorithm",
      "Group private sessions",
    ],
    businessLogic: [
      "Different cancellation policies per type",
      "Package credit management",
      "Instructor specialization matching",
      "First-time client pricing",
    ],
    integrations: ["Class management", "Instructor scheduling", "Progress tracking", "CRM"],
  },
  {
    id: "accommodation-packages",
    name: "Accommodation + Packages",
    icon: Waves,
    categoryGroup: "Hybrid",
    tagline: "Stay booking combined with activity and experience packages",
    description:
      "A resort-style booking system that combines accommodation selection with activity packages. Users book their stay and add experiences like surf lessons, spa treatments, or tours.",
    idealFor: [
      "Surf camps",
      "Ski resorts",
      "Wellness retreats",
      "Adventure lodges",
      "All-inclusive resorts",
      "Eco-lodges with tours",
    ],
    userFlow: [
      { step: 1, title: "Enter Stay Dates", description: "Select arrival and departure dates" },
      { step: 2, title: "Select Accommodation", description: "Choose room type or cabin" },
      { step: 3, title: "Browse Packages", description: "View available activity packages" },
      { step: 4, title: "Customize Package", description: "Select specific activities and times" },
      { step: 5, title: "Review & Book", description: "See total for stay + activities" },
    ],
    keyFeatures: [
      "Date range picker for stay",
      "Accommodation cards with rates",
      "Package cards with included activities",
      "Activity calendar during stay",
      "Combined pricing display",
    ],
    dataRequirements: {
      required: ["accommodations", "packages", "activities", "availability"],
      optional: ["equipment_included", "skill_levels", "dietary_options", "transfer_options"],
    },
    uiComponents: ["DateRangePicker", "AccommodationCard", "PackageCard", "ActivityCalendar", "CombinedSummary"],
    scalingConsiderations: [
      "Custom package builder",
      "Transfer/airport pickup",
      "Dietary preference handling",
      "Equipment rental integration",
      "Weather-dependent rebooking",
      "Group booking coordination",
    ],
    businessLogic: [
      "Package discount calculations",
      "Activity capacity during stay",
      "Weather cancellation policies",
      "Equipment size/preference collection",
      "Multi-person package pricing",
    ],
    integrations: ["Activity scheduling", "Equipment management", "Weather services", "Transfer coordination"],
  },
  {
    id: "contact-hub",
    name: "Contact Hub",
    icon: MessageSquare,
    categoryGroup: "Support & Communication",
    tagline: "Unified contact center routing requests to forms or scheduling",
    description:
      "A centralized contact system that routes different request types to appropriate flows. Questions and bug reports lead to forms, while demo requests and sales inquiries lead to scheduling interfaces. Perfect for businesses managing multiple contact channels.",
    idealFor: [
      "SaaS companies",
      "Enterprise support teams",
      "Product companies",
      "Service businesses",
      "Startups with multiple contact needs",
      "Customer success teams",
    ],
    userFlow: [
      { step: 1, title: "Select Request Type", description: "Choose from question, feature request, bug report, pricing inquiry, or demo request" },
      { step: 2, title: "Route to Flow", description: "Forms for feedback/bugs, scheduling for demos/sales" },
      { step: 3, title: "Complete Form/Schedule", description: "Fill relevant form or pick demo date/time" },
      { step: 4, title: "Confirmation", description: "Receive confirmation with ticket number or meeting details" },
    ],
    keyFeatures: [
      "Request type cards with clear descriptions",
      "Conditional routing (form vs scheduling)",
      "Bug report form with reproduction steps",
      "Feature request with priority/impact",
      "Demo scheduling with calendar integration",
      "Ticket/reference number generation",
    ],
    dataRequirements: {
      required: ["request_types", "form_schemas", "availability", "contact_info"],
      optional: ["product_areas", "priority_levels", "attachments", "calendar_sync"],
    },
    uiComponents: ["RequestTypeCard", "DynamicForm", "SchedulingWidget", "FileUpload", "ConfirmationCard"],
    scalingConsiderations: [
      "Integration with helpdesk systems",
      "Auto-routing based on keywords",
      "SLA indicators per request type",
      "Customer history lookup",
      "Chatbot pre-qualification",
      "Team member assignment rules",
    ],
    businessLogic: [
      "Request type determines flow (form vs schedule)",
      "Priority escalation rules",
      "Response time commitments",
      "Demo availability by region/timezone",
      "Auto-assignment to team members",
    ],
    integrations: ["Helpdesk (Zendesk, Intercom)", "Calendar (Google, Outlook)", "CRM", "Slack notifications", "Email systems"],
  },
];

// Group by category
const categories = [
  { id: "1:1 Services", label: "1:1 Service Appointments", description: "Individual appointments with providers" },
  { id: "Classes & Events", label: "Classes & Group Events", description: "Scheduled group activities and workshops" },
  { id: "Resources & Spaces", label: "Resources & Spaces", description: "Facility and resource reservations" },
  { id: "Stays & Rentals", label: "Stays & Rentals", description: "Accommodation and item rentals" },
  { id: "Hybrid", label: "Hybrid Archetypes", description: "Combined booking patterns" },
  { id: "Support & Communication", label: "Support & Communication", description: "Contact forms, feedback, and scheduling" },
];

// =============================================================================
// COMPONENTS
// =============================================================================

// Map of built archetype pages
const builtArchetypePages: Record<string, string> = {
  "healthcare": "/simplified-archetypes-opus/healthcare-appointment",
  "beauty": "/simplified-archetypes-opus/beauty-personal-care",
  "lab-booking": "/simplified-archetypes-opus/lab-booking",
  "fitness-class": "/simplified-archetypes-opus/fitness-class",
  "tour": "/simplified-archetypes-opus/tours-experiences",
  "workspace": "/simplified-archetypes-opus/workspace-meeting",
  "accommodation": "/simplified-archetypes-opus/accommodation-packages",
  "accommodation-packages": "/simplified-archetypes-opus/accommodation-packages",
  "multi-location": "/simplified-archetypes-opus/multi-location",
  "contact-hub": "/simplified-archetypes-opus/contact-hub",
};

function ArchetypeDetailCard({ archetype }: { archetype: ArchetypeDetail }) {
  const [isOpen, setIsOpen] = useState(false);
  const Icon = archetype.icon;
  const demoLink = builtArchetypePages[archetype.id];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="overflow-hidden transition-all hover:shadow-md">
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Icon className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <CardTitle className="text-lg">{archetype.name}</CardTitle>
                  <Badge variant="outline" className="text-xs">
                    {archetype.categoryGroup}
                  </Badge>
                  {demoLink && (
                    <Badge className="text-xs bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/30">
                      Demo Available
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{archetype.tagline}</p>
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                {demoLink && (
                  <Link
                    to={demoLink}
                    onClick={(e) => e.stopPropagation()}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    View Demo
                    <ChevronRight className="h-3 w-3" />
                  </Link>
                )}
                {isOpen ? (
                  <ChevronDown className="h-5 w-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="pt-0 space-y-6">
            {/* Description */}
            <div>
              <p className="text-sm leading-relaxed">{archetype.description}</p>
            </div>

            {/* Ideal For */}
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Users className="h-4 w-4 text-primary" />
                Ideal For
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {archetype.idealFor.map((item) => (
                  <Badge key={item} variant="secondary" className="text-xs font-normal">
                    {item}
                  </Badge>
                ))}
              </div>
            </div>

            {/* User Flow */}
            <div>
              <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                User Flow
              </h4>
              <div className="space-y-2">
                {archetype.userFlow.map((step, index) => (
                  <div key={index} className="flex gap-3 items-start">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 text-xs font-medium text-primary">
                      {step.step}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{step.title}</p>
                      <p className="text-xs text-muted-foreground">{step.description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Key Features */}
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Key Features
              </h4>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-1">
                {archetype.keyFeatures.map((feature) => (
                  <li key={feature} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-primary mt-1">•</span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            {/* Data Requirements */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-orange-500" />
                  Required Data
                </h4>
                <div className="flex flex-wrap gap-1">
                  {archetype.dataRequirements.required.map((item) => (
                    <Badge key={item} variant="outline" className="text-xs font-mono bg-orange-50 dark:bg-orange-950/30 border-orange-200 dark:border-orange-800">
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-blue-500" />
                  Optional Data
                </h4>
                <div className="flex flex-wrap gap-1">
                  {archetype.dataRequirements.optional.map((item) => (
                    <Badge key={item} variant="outline" className="text-xs font-mono bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                      {item}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* UI Components */}
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Layers className="h-4 w-4 text-primary" />
                UI Components Needed
              </h4>
              <div className="flex flex-wrap gap-1">
                {archetype.uiComponents.map((component) => (
                  <Badge key={component} variant="secondary" className="text-xs font-mono">
                    {component}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Scaling Considerations */}
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                Scaling to Full Page
              </h4>
              <ul className="grid grid-cols-1 md:grid-cols-2 gap-1">
                {archetype.scalingConsiderations.map((item) => (
                  <li key={item} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-primary mt-1">→</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Business Logic */}
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-primary" />
                Business Logic Rules
              </h4>
              <ul className="space-y-1">
                {archetype.businessLogic.map((rule) => (
                  <li key={rule} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-amber-500 mt-1">⚡</span>
                    {rule}
                  </li>
                ))}
              </ul>
            </div>

            {/* Integrations */}
            <div>
              <h4 className="text-sm font-semibold mb-2 flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                Common Integrations
              </h4>
              <div className="flex flex-wrap gap-1">
                {archetype.integrations.map((integration) => (
                  <Badge key={integration} variant="outline" className="text-xs">
                    {integration}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function ArchetypesExplainedPage() {
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-5xl mx-auto py-8 md:py-12 px-4">
        {/* Header */}
        <div className="mb-8">
          <Link
            to="/simplified-archetypes-opus"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Archetypes
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">
            Archetype Documentation
          </h1>
          <p className="text-lg text-muted-foreground max-w-3xl">
            Detailed analysis of each booking archetype — understanding their user flows, data requirements, 
            and considerations for scaling from simplified components to full-page implementations.
          </p>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card className="p-4 text-center">
            <p className="text-3xl font-bold text-primary">{archetypeDetails.length}</p>
            <p className="text-sm text-muted-foreground">Archetypes</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-3xl font-bold text-primary">{categories.length}</p>
            <p className="text-sm text-muted-foreground">Categories</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-3xl font-bold text-primary">70+</p>
            <p className="text-sm text-muted-foreground">Use Cases</p>
          </Card>
          <Card className="p-4 text-center">
            <p className="text-3xl font-bold text-primary">100+</p>
            <p className="text-sm text-muted-foreground">Components</p>
          </Card>
        </div>

        {/* Categories */}
        {categories.map((category) => {
          const categoryArchetypes = archetypeDetails.filter(
            (a) => a.categoryGroup === category.id
          );
          const isExpanded = expandedCategory === category.id;

          return (
            <div key={category.id} className="mb-8">
              <button
                onClick={() => setExpandedCategory(isExpanded ? null : category.id)}
                className="w-full text-left mb-4 group"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl md:text-2xl font-semibold group-hover:text-primary transition-colors">
                      {category.label}
                    </h2>
                    <p className="text-sm text-muted-foreground">{category.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{categoryArchetypes.length}</Badge>
                    {isExpanded ? (
                      <ChevronDown className="h-5 w-5 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                </div>
              </button>

              <div
                className={cn(
                  "space-y-4 transition-all duration-300",
                  isExpanded ? "opacity-100" : "opacity-100"
                )}
              >
                {categoryArchetypes.map((archetype) => (
                  <ArchetypeDetailCard key={archetype.id} archetype={archetype} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
