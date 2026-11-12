#!/usr/bin/env ruby
# ALL-243: reproducible native-target integration after Expo prebuild.
# Runs only for opted-in, signed iOS builds. It extends Expo's generated
# Xcode project; does not replace the app or create a parallel Xcode project.
require 'fileutils'
require 'pathname'

begin
  require 'xcodeproj' # Installed alongside CocoaPods on macOS/EAS iOS
rescue LoadError
  abort 'Missing xcodeproj Ruby gem. Install the CocoaPods toolchain first.'
end

root = File.expand_path('..', __dir__)
app = File.join(root, 'apps', 'mobile-v2')
native = File.join(app, 'native', 'apple-watch')
ios_dir = File.join(app, 'ios')
bundle_id = ENV.fetch('ALLIN_V2_IOS_BUNDLE_ID', '').strip
unless bundle_id.match?(/\A[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+\z/) && bundle_id.length <= 180
  abort 'Watch target requires an exact verified ALLIN_V2_IOS_BUNDLE_ID; no fallback bundle identifier.'
end
unless File.directory?(ios_dir)
  abort 'Expo ios/ project missing; run expo prebuild --platform ios before attaching the watch target.'
end
projects = Dir.glob(File.join(ios_dir, '*.xcodeproj'))
abort 'Expected exactly one Expo-generated Xcode project' unless projects.length == 1
project = Xcodeproj::Project.open(projects.fetch(0))
app_target = project.targets.select do |target|
  target.product_type == 'com.apple.product-type.application'
end
abort 'Expected exactly one Expo iPhone application target' unless app_target.length == 1
iphone = app_target.fetch(0)
watch_name = 'ALLIN365Watch'
watch_bundle = "#{bundle_id}.watchkitapp"

watch_files = %w[ALLIN365WatchApp.swift WatchPairingChallengeSigner.swift]
phone_files = %w[IPhoneWatchPairingCoordinator.swift IPhoneAppAttestEnrollment.swift
                 ALLINWatchPairingModule.swift ALLINWatchPairingModule.m]
(watch_files + phone_files).each do |file|
  abort "Missing canonical native source #{file}" unless File.file?(File.join(native, file))
end
watch_dir = File.join(ios_dir, 'ALLIN365Watch')
bridge_dir = File.join(ios_dir, 'ALLINWatchBridge')
FileUtils.mkdir_p(watch_dir)
FileUtils.mkdir_p(bridge_dir)
watch_files.each { |f| FileUtils.cp(File.join(native, f), File.join(watch_dir, f)) }
phone_files.each { |f| FileUtils.cp(File.join(native, f), File.join(bridge_dir, f)) }

watch = project.targets.find { |target| target.name == watch_name }
if watch.nil?
  watch = project.new_target(:watch2_app, watch_name, :watchos, '10.0')
end
unless watch.product_type == 'com.apple.product-type.application.watchapp2'
  abort 'Existing watch target has an unexpected product type; refusing to overwrite.'
end

watch_group = project.main_group.find_subpath('ALLIN365Watch', true)
watch_group.set_source_tree('<group>')
watch_group.path = 'ALLIN365Watch'
bridge_group = project.main_group.find_subpath('ALLINWatchBridge', true)
bridge_group.set_source_tree('<group>')
bridge_group.path = 'ALLINWatchBridge'

def ensure_source(group, target, file)
  reference = group.files.find { |f| f.path == file } || group.new_file(file)
  unless target.source_build_phase.files_references.include?(reference)
    target.source_build_phase.add_file_reference(reference)
  end
end
watch_files.each { |f| ensure_source(watch_group, watch, f) }
phone_files.each { |f| ensure_source(bridge_group, iphone, f) }

watch.build_configurations.each do |cfg|
  values = {
    'SWIFT_VERSION' => '5.0',
    'SDKROOT' => 'watchos',
    'WATCHOS_DEPLOYMENT_TARGET' => '10.0',
    'TARGETED_DEVICE_FAMILY' => '4',
    'SUPPORTED_PLATFORMS' => 'watchos watchsimulator',
    'PRODUCT_BUNDLE_IDENTIFIER' => watch_bundle,
    'PRODUCT_NAME' => watch_name,
    'GENERATE_INFOPLIST_FILE' => 'YES',
    'INFOPLIST_KEY_WKWatchKitApp' => 'YES',
    'INFOPLIST_KEY_WKCompanionAppBundleIdentifier' => bundle_id,
    'INFOPLIST_KEY_WKRunsIndependentlyOfCompanionApp' => 'NO',
    'SKIP_INSTALL' => 'YES',
    'CODE_SIGN_STYLE' => 'Automatic',
  }
  cfg.build_settings.merge!(values)
end

# Do not modify existing store IDs or signing teams: they belong to
# independently verified EAS / Apple developer credentials.
iphone.build_configurations.each do |cfg|
  current = cfg.build_settings['PRODUCT_BUNDLE_IDENTIFIER']
  if current && !current.to_s.include?('$(') && current != bundle_id
    abort "Existing iOS target uses #{current.inspect}, not #{bundle_id.inspect}"
  end
end

unless iphone.dependencies.any? { |dependency| dependency.target == watch }
  iphone.add_dependency(watch)
end
unless iphone.build_phases.any? { |phase| phase.is_a?(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase) && phase.name == 'Embed Watch Content' }
  phase = project.new(Xcodeproj::Project::Object::PBXCopyFilesBuildPhase)
  phase.name = 'Embed Watch Content'
  phase.dst_subfolder_spec = '16'
  phase.dst_path = '$(CONTENTS_FOLDER_PATH)/Watch'
  phase.add_file_reference(watch.product_reference, true)
  iphone.build_phases << phase
end
project.save
puts "ALL-243 attached #{watch_name} watchOS app to #{iphone.name}; included 4 native iPhone bridge files and watch approval UI"
