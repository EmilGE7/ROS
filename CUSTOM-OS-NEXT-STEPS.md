# RescueOS custom OS integration

The `deployment/debian-live/` folder contains the Debian Live build configuration integrating this existing web project into a bootable Linux image.

Branding is set to RescueOS (hostname, OS identity, login session, kiosk, splash configuration). The intended end-user experience is a dedicated RescueOS-only full-screen interface, not a general Debian desktop.

This is a build scaffold, not a prebuilt or verified ISO. Build it on Debian/Ubuntu Linux and test the resulting ISO in a VM and on physical hardware. Test the splash and boot menu branding separately; firmware screens are outside the OS's control.
