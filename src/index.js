import { RemoteService, LocalService } from './service';
import { stripSlashes } from '@feathersjs/commons';
import cote from 'cote';
import uuid from 'uuid/v4';
import makeDebug from 'debug';

const debug = makeDebug('feathers-distributed');

export default function init (options) {
  return function () {
    const distributionOptions = Object.assign(
      {
        publicationDelay: 5000
      },
      options
    );
    let app = this;
    // We need to uniquely identify the app to avoid infinite loop by registering our own services
    app.uuid = uuid();
    debug('Initializing feathers-distributed');

    // This publisher publishes an event each time a local app service is registered
    app.servicePublisher = new cote.Publisher(
      {
        name: 'feathers services publisher',
        namespace: 'services',
        broadcasts: ['service']
      },
      { log: false }
    );
    // Also each time a new node pops up so that it does not depend of the initialization order of the apps
    app.servicePublisher.on('cote:added', data => {
      // console.log(data)
      // Add a timeout so that the subscriber has been initialized on the node
      setTimeout(_ => {
        Object.getOwnPropertyNames(app.services).forEach(path => {
          app.servicePublisher.publish('service', { uuid: app.uuid, path });
          debug('Republished local service on path ' + path);
        });
      }, distributionOptions.publicationDelay);
    });
    // This subscriber listen to an event each time a remote app service has been registered
    app.serviceSubscriber = new cote.Subscriber(
      {
        name: 'feathers services subscriber',
        namespace: 'services',
        subscribesTo: ['service']
      },
      { log: false }
    );
    // When a remote service is declared create the local proxy interface to it
    app.serviceSubscriber.on('service', serviceDescriptor => {
      // Do not register our own services
      if (serviceDescriptor.uuid === app.uuid) {
        debug('Do not register service as remote on path ' + serviceDescriptor.path);
        return;
      }
      // Skip already registered services
      const service = app.service(serviceDescriptor.path);
      if (service) {
        if (service instanceof RemoteService) {
          debug('Already registered service as remote on path ' + serviceDescriptor.path);
        } else {
          debug('Already registered local service on path ' + serviceDescriptor.path);
        }
        return;
      }

      if(distributionOptions.remotes) {
        distributionOptions.remotes.forEach(remote =>  {
          if(remote === serviceDescriptor.path) {
            app.use(serviceDescriptor.path, new RemoteService(serviceDescriptor));
            debug('Registered remote service on path ' + serviceDescriptor.path);
          }
        })
      }

      // registering hook object on every remote service
      if (distributionOptions.hooks) {
        app.service(serviceDescriptor.path).hooks(distributionOptions.hooks);
      }
      debug('Registered hooks on remote service on path ' + serviceDescriptor.path);


      // dispatch an event internally through node so that async processes can run
      app.emit('service', serviceDescriptor);
    });

    // We replace the use method to inject service publisher/responder
    const superUse = app.use;
    app.use = function (path, service) {
      // Register the service normally first
      superUse.apply(app, arguments);
      // Note: middlewares are not supported
      // Also avoid infinite loop by registering already registered remote services
      if (typeof service === 'object' && !service.remote) {
        // Publish new local service
        if(!distributionOptions.gateway) {
          app.servicePublisher.publish('service', { uuid: app.uuid, path: stripSlashes(path) });
          debug('Published local service on path ' + path);
        }
        // Register the responder to handle remote calls to the service
        service.responder = new LocalService({ app, path: stripSlashes(path) });
      }
    };
  };
}

// init.RemoteService = RemoteService;
// init.LocalService = LocalService;
